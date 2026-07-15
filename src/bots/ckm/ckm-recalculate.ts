// Bot CKM: recalcula hGraph y estadío del paciente cuando llega una
// Observation nueva (o editada) con algún parámetro CKM, y notifica al
// profesional cuando hay empeoramiento de estadío o valores críticos.
//
// Se despliega con una Subscription cuyo criteria filtra por los códigos LOINC
// CKM (ver deploy-bots.ts). Flujo:
// 1. Extrae el paciente de la Observation recibida
// 2. Relee todas las Observations CKM y se queda con el último valor de cada
//    parámetro (acepta el panel de PA 85354-9 y la forma legacy separada)
// 3. Calcula scores/status de cada métrica y deriva el estadío CKM
//    (estadío 4 si hay Condition activa de ECV clínica)
// 4. Actualiza las extensiones CKMStage y hGraphData del Patient
// 5. Si el estadío empeoró, o la Observation que disparó el bot trae un valor
//    crítico (CRITICAL_LIMITS), crea una Communication categoría 'alert' (la
//    que muestra el dashboard /ckm) y envía email vía SES con
//    medplum.sendEmail() al médico de cabecera (generalPractitioner con email
//    en telecom) o al secret CKM_ALERT_EMAIL del Bot. El email no incluye
//    datos clínicos ni nombre del paciente, solo el link al chart.
// 6. Alertas de tendencia "3 strikes" (ckm/alert-rules): si hay 3+ lecturas
//    anormales repetidas (PA elevada, HDL bajo, etc.) crea un DetectedIssue
//    (ancla anti-spam, con cooldown), una Communication 'alert', una Task de
//    revisión asignada al médico de cabecera y envía el email. No re-alerta una
//    regla que ya tenga un DetectedIssue dentro de ALERT_COOLDOWN_DAYS.
//
// Secrets del Bot (opcionales):
// - CKM_ALERT_EMAIL: destinatario de respaldo si el paciente no tiene
//   generalPractitioner con email
// - CKM_APP_URL: base del link al chart (default https://seguimiento.medplum.com.ar)
// - CKM_ALERT_MIN_COUNT: lecturas anormales para disparar tendencia (default 3)
// - CKM_ALERT_WINDOW_DAYS: ventana de conteo en días (default 180)
import type { BotEvent, MedplumClient } from '@medplum/core';
import type {
  Communication,
  Condition,
  DetectedIssue,
  Observation,
  Patient,
  Practitioner,
  Reference,
  Task,
} from '@medplum/fhirtypes';
import type { CKMObservationMap } from '../../ckm/observations';
import type { PREVENTScores } from '../../ckm/types';
import type { TriggeredAlert } from '../../ckm/alert-rules';
import { ALERT_RULE_SYSTEM, DEFAULT_ALERT_CONFIG, evaluateThresholdRules } from '../../ckm/alert-rules';
import {
  ageFromBirthDate,
  deriveMedicationFlags,
  hasDiabetes,
  hasSmoking,
  isActiveCondition,
  isClinicalCVD,
  patientPreventSex,
} from '../../ckm/clinical';
import { getCKMStage, getHGraphData, withCKMExtensions } from '../../ckm/extensions';
import {
  extractCKMValues,
  getCKMObservationHistory,
  getLatestCKMObservations,
  isImplausibleBloodPressure,
} from '../../ckm/observations';
import { buildPreventInputs, computePrevent } from '../../ckm/prevent';
import { computeMetrics, deriveStage, detectCriticalValues } from '../../ckm/scoring';

const DEFAULT_APP_URL = 'https://seguimiento.medplum.com.ar';

// Ventana de silencio (días) para no re-alertar la misma regla de tendencia:
// si ya hay un DetectedIssue de esa regla en este lapso, no se vuelve a notificar.
const ALERT_COOLDOWN_DAYS = 30;

/**
 * Recolecta las variables PREVENT del paciente y calcula los scores.
 * Devuelve undefined si faltan datos o si los coeficientes no están
 * verificados (computePrevent lo decide).
 */
async function computePreventScores(
  medplum: MedplumClient,
  patient: Patient,
  values: CKMObservationMap,
  activeConditions: Condition[]
): Promise<PREVENTScores | undefined> {
  const sex = patientPreventSex(patient);
  if (!sex) {
    return undefined;
  }

  const medications = await medplum.searchResources('MedicationRequest', {
    subject: `Patient/${patient.id}`,
    status: 'active',
    _count: '100',
  });
  const { onStatin, onAntihypertensive } = deriveMedicationFlags(medications);

  const inputs = buildPreventInputs(values, {
    sex,
    ageYears: ageFromBirthDate(patient.birthDate),
    diabetes: hasDiabetes(activeConditions),
    smoking: hasSmoking(activeConditions),
    onAntihypertensive,
    onStatin,
  });
  return inputs ? computePrevent(inputs) : undefined;
}

/**
 * Recalcula y persiste las extensiones CKM (métricas hGraph, estadío, PREVENT)
 * de un paciente a partir de sus últimas Observations. NO genera alertas — eso
 * queda para el handler disparado por Observation. Reutilizable por el bot cron.
 * Si el paciente no tiene datos CKM ni cálculo previo, no escribe nada.
 */
export async function recomputeCKM(medplum: MedplumClient, patient: Patient): Promise<Patient> {
  const patientId = patient.id as string;
  const values = await getLatestCKMObservations(medplum, patientId);

  const conditions = await medplum.searchResources('Condition', {
    subject: `Patient/${patientId}`,
    _count: '200',
  });
  const active = conditions.filter(isActiveCondition);
  const hasClinicalCVD = active.some(isClinicalCVD);

  const previousStage = getCKMStage(patient);
  const previous = getHGraphData(patient);

  // Sin datos CKM ni cálculo previo: nada que recalcular (evita escrituras
  // vacías cuando el cron recorre pacientes que no son del programa CKM).
  if (
    Object.keys(values).length === 0 &&
    previous.metrics === undefined &&
    previous.prevent === undefined &&
    previousStage === undefined
  ) {
    return patient;
  }

  const computedMetrics = computeMetrics(values);
  // Si no quedan datos evaluables (ej. lectura vacía o única lectura descartada),
  // conservar las métricas previas en lugar de borrarlas — mismo criterio que el
  // estadío y el PREVENT. Evita que una corrida con búsqueda vacía (lag de
  // indexación, política de acceso, etc.) pise datos buenos con un array vacío.
  const metrics = computedMetrics.length > 0 ? computedMetrics : (previous.metrics ?? []);
  // Si no quedan datos evaluables (ej. única lectura descartada), conservar
  // el estadío previo en lugar de borrarlo
  const stage = deriveStage(values, { hasClinicalCVD, gender: patient.gender }) ?? previousStage;

  // Scores PREVENT: se recalculan sólo si los coeficientes están verificados
  // (computePrevent devuelve undefined si no). Si no, se preservan los previos.
  const prevent = (await computePreventScores(medplum, patient, values, active)) ?? previous.prevent;

  return medplum.updateResource({
    ...patient,
    extension: withCKMExtensions(patient, stage, { metrics, prevent }),
  });
}

export async function handler(medplum: MedplumClient, event: BotEvent<Observation>): Promise<Patient | undefined> {
  const observation = event.input;

  // Solo reaccionar a Observations de parámetros CKM con sujeto Patient
  const triggeredValues = extractCKMValues(observation);
  const patientId = observation.subject?.reference?.match(/^Patient\/(.+)$/)?.[1];
  if (!patientId || Object.keys(triggeredValues).length === 0) {
    return undefined;
  }

  const patient = await medplum.readResource('Patient', patientId);
  const previousStage = getCKMStage(patient);
  const updated = await recomputeCKM(medplum, patient);
  const stage = getCKMStage(updated);

  // Alertas: empeoramiento de estadío, valor crítico en la Observation que
  // disparó el bot (solo lo recién llegado, para no re-alertar valores
  // viejos), o lectura de PA implausible (campos cruzados al cargar)
  const messages: string[] = [];
  if (previousStage !== undefined && stage !== undefined && stage > previousStage) {
    messages.push(`El estadío CKM pasó de ${previousStage} a ${stage}.`);
  }
  if (isImplausibleBloodPressure(triggeredValues)) {
    messages.push(
      `Registro de presión arterial inconsistente (sistólica ${triggeredValues.sbp?.value} menor o igual que ` +
        `diastólica ${triggeredValues.dbp?.value}). Verificar la carga; el valor no se usó para el cálculo.`
    );
    // No evaluar valores críticos sobre una lectura cruzada
    delete triggeredValues.sbp;
    delete triggeredValues.dbp;
  }
  messages.push(...detectCriticalValues(triggeredValues).map((c) => c.message));

  if (messages.length > 0) {
    await createAlertCommunication(medplum, patient, messages);
    await sendAlertEmail(medplum, event, patient, messages.length);
  }

  // Alertas de tendencia "3 strikes": 3+ lecturas anormales (PA elevada, HDL
  // bajo, etc.). Aisladas en try/catch para no afectar el recálculo si fallan.
  try {
    await evaluateTrendAlerts(medplum, event, patient);
  } catch (err) {
    console.error(`Patient/${patient.id}: error evaluando alertas de tendencia`, err);
  }

  return updated;
}

/**
 * Evalúa las reglas de tendencia sobre el historial del paciente y notifica
 * (DetectedIssue + Communication + Task + email) las reglas recién disparadas,
 * evitando re-alertar las que ya tienen un DetectedIssue dentro del cooldown.
 */
async function evaluateTrendAlerts(
  medplum: MedplumClient,
  event: BotEvent<Observation>,
  patient: Patient
): Promise<void> {
  const config = {
    minCount: Number(event.secrets['CKM_ALERT_MIN_COUNT']?.valueString) || DEFAULT_ALERT_CONFIG.minCount,
    windowDays: Number(event.secrets['CKM_ALERT_WINDOW_DAYS']?.valueString) || DEFAULT_ALERT_CONFIG.windowDays,
  };
  const history = await getCKMObservationHistory(medplum, patient.id as string);
  const triggered = evaluateThresholdRules(history, patientPreventSex(patient), config);

  for (const alert of triggered) {
    if (await hasRecentDetectedIssue(medplum, patient.id as string, alert.ruleId)) {
      continue;
    }
    await createDetectedIssue(medplum, patient, alert);
    await createAlertCommunication(medplum, patient, [alert.message]);
    await createReviewTask(medplum, patient, alert);
    await sendAlertEmail(medplum, event, patient, 1);
    console.log(`Patient/${patient.id}: alerta de tendencia "${alert.ruleId}" (${alert.count} lecturas)`);
  }
}

/** ¿Hay un DetectedIssue de esta regla para el paciente dentro del cooldown? */
async function hasRecentDetectedIssue(medplum: MedplumClient, patientId: string, ruleId: string): Promise<boolean> {
  const existing = await medplum.searchResources('DetectedIssue', {
    patient: `Patient/${patientId}`,
    code: `${ALERT_RULE_SYSTEM}|${ruleId}`,
    _sort: '-_lastUpdated',
    _count: '1',
  });
  const last = existing[0];
  if (!last) {
    return false;
  }
  const when = last.identifiedDateTime ?? last.meta?.lastUpdated;
  if (!when) {
    return true; // existe pero sin fecha: por las dudas no re-alertar
  }
  return Date.now() - new Date(when).getTime() < ALERT_COOLDOWN_DAYS * 24 * 3600 * 1000;
}

/** Registra el problema detectado por la regla (ancla del anti-spam). */
async function createDetectedIssue(medplum: MedplumClient, patient: Patient, alert: TriggeredAlert): Promise<void> {
  const issue: DetectedIssue = {
    resourceType: 'DetectedIssue',
    status: 'final',
    severity: 'moderate',
    code: { coding: [{ system: ALERT_RULE_SYSTEM, code: alert.ruleId, display: alert.label }], text: alert.label },
    patient: { reference: `Patient/${patient.id}` },
    identifiedDateTime: new Date().toISOString(),
    detail: alert.message,
  };
  await medplum.createResource(issue);
}

/** Crea una tarea de revisión asignada al médico de cabecera (si lo hay). */
async function createReviewTask(medplum: MedplumClient, patient: Patient, alert: TriggeredAlert): Promise<void> {
  const owner = patient.generalPractitioner?.find((r) => r.reference?.startsWith('Practitioner/'));
  const task: Task = {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: 'urgent',
    code: { text: 'Revisar paciente — alerta CKM' },
    description: alert.message,
    for: { reference: `Patient/${patient.id}` },
    owner,
    authoredOn: new Date().toISOString(),
  };
  await medplum.createResource(task);
}

async function createAlertCommunication(medplum: MedplumClient, patient: Patient, messages: string[]): Promise<void> {
  const communication: Communication = {
    resourceType: 'Communication',
    status: 'in-progress',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/communication-category', code: 'alert' }] }],
    subject: { reference: `Patient/${patient.id}` },
    recipient: patient.generalPractitioner?.filter((r) => r.reference?.startsWith('Practitioner/')),
    sent: new Date().toISOString(),
    payload: messages.map((message) => ({ contentString: message })),
  };
  await medplum.createResource(communication);
}

async function sendAlertEmail(
  medplum: MedplumClient,
  event: BotEvent<Observation>,
  patient: Patient,
  alertCount: number
): Promise<void> {
  const to = await resolveAlertEmail(medplum, event, patient);
  if (!to) {
    console.log(
      `Patient/${patient.id}: alerta sin email (sin generalPractitioner con email ni secret CKM_ALERT_EMAIL)`
    );
    return;
  }
  const appUrl = event.secrets['CKM_APP_URL']?.valueString ?? DEFAULT_APP_URL;
  // Por privacidad el correo no lleva nombre del paciente ni datos clínicos
  await medplum.sendEmail({
    to,
    subject: 'Alerta CKM — paciente de su panel',
    text:
      `Se ${alertCount === 1 ? 'registró 1 alerta' : `registraron ${alertCount} alertas`} CKM ` +
      'para un paciente de su panel.\n\n' +
      `Ver el chart: ${appUrl}/Patient/${patient.id}\n\n` +
      'Por privacidad este correo no incluye datos clínicos. ' +
      'La alerta completa está disponible al iniciar sesión.',
  });
}

async function resolveAlertEmail(
  medplum: MedplumClient,
  event: BotEvent<Observation>,
  patient: Patient
): Promise<string | undefined> {
  const gpRef = patient.generalPractitioner?.find((r) => r.reference?.startsWith('Practitioner/'));
  if (gpRef) {
    try {
      const practitioner = await medplum.readReference(gpRef as Reference<Practitioner>);
      const email = practitioner.telecom?.find((t) => t.system === 'email')?.value;
      if (email) {
        return email;
      }
    } catch (err) {
      console.error(`No se pudo leer ${gpRef.reference}`, err);
    }
  }
  return event.secrets['CKM_ALERT_EMAIL']?.valueString;
}

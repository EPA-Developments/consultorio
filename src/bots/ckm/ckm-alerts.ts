// Bot de alertas CKM: la regla "3 strikes" sobre tendencias anormales.
//
// Es un bot PROPIO, separado de ckm-recalculate, por la decisión que quedó
// documentada allá: las notificaciones no deben poder interrumpir el recálculo.
// Este bot puede fallar entero y el estadío y los scores PREVENT se siguen
// calculando; y viceversa.
//
// Hasta este bot, el circuito de alertas era un artefacto sin escritor: las
// reglas existían (alert-rules.ts), el Home y el panel CKM las LEÍAN
// (Communication?category=alert), verify-alerts las validaba — y nada las
// creaba. El médico veía "Sin alertas abiertas" como un hecho clínico cuando
// era un hueco de implementación.
//
// Qué crea cuando una regla dispara (la forma que verify-alerts espera y que
// el panel ya lee):
// - DetectedIssue con code {ALERT_RULE_SYSTEM | ruleId}: el registro del
//   hallazgo, y la memoria del cooldown.
// - Task para el médico: la unidad de trabajo revisable.
// - Communication con category 'alert': lo que encienden el Home y el panel.
//
// COOLDOWN. Una tendencia dispara una vez cada 30 días, no en cada Observation
// nueva: sin esto, cada control de presión de un hipertenso conocido generaría
// una alerta idéntica y el médico aprendería a ignorarlas, que es peor que no
// tener alertas.
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Bundle, BundleEntry, Communication, DetectedIssue, Observation, Patient, Task } from '@medplum/fhirtypes';
import { ALERT_RULE_SYSTEM, evaluateThresholdRules } from '../../ckm/alert-rules';
import type { AlertSex, TriggeredAlert } from '../../ckm/alert-rules';
import { extractCKMValues, getCKMObservationHistory } from '../../ckm/observations';

/** Días sin re-alertar la misma regla sobre el mismo paciente. */
export const COOLDOWN_DIAS = 30;

const CATEGORIA_ALERTA = {
  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/communication-category', code: 'alert' }],
};

function sexoDe(patient: Patient): AlertSex {
  return patient.gender === 'female' || patient.gender === 'male' ? patient.gender : undefined;
}

/**
 * ¿La regla ya alertó dentro de la ventana de cooldown?
 *
 * Se decide contra los DetectedIssue existentes, no contra un estado propio:
 * el DetectedIssue ES la memoria del sistema, y borrarlo (como hace
 * verify-alerts al limpiar) rehabilita la alerta — que es el comportamiento
 * esperado en una corrida de verificación.
 */
export function enCooldown(existentes: DetectedIssue[], ruleId: string, ahora: Date, dias = COOLDOWN_DIAS): boolean {
  const desde = ahora.getTime() - dias * 24 * 3600 * 1000;
  return existentes.some((d) => {
    const esLaRegla = d.code?.coding?.some((c) => c.system === ALERT_RULE_SYSTEM && c.code === ruleId);
    if (!esLaRegla) {
      return false;
    }
    const cuando = d.identifiedDateTime ? new Date(d.identifiedDateTime).getTime() : NaN;
    // Un DetectedIssue de la regla sin fecha legible cuenta como reciente:
    // ante la duda, NO repetir la alerta (el costo de un duplicado es
    // acostumbrar al médico a ignorarlas).
    return Number.isNaN(cuando) ? true : cuando >= desde;
  });
}

/** Los tres recursos de una alerta disparada, como transacción. */
export function recursosDeAlerta(alerta: TriggeredAlert, patientId: string, ahora: Date): Bundle {
  const subject = { reference: `Patient/${patientId}` };
  const fecha = ahora.toISOString();

  const issue: DetectedIssue = {
    resourceType: 'DetectedIssue',
    status: 'final',
    patient: subject,
    identifiedDateTime: fecha,
    code: { coding: [{ system: ALERT_RULE_SYSTEM, code: alerta.ruleId, display: alerta.label }] },
    detail: alerta.message,
  };

  const task: Task = {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: 'urgent',
    for: subject,
    authoredOn: fecha,
    code: { text: `Revisar tendencia: ${alerta.label}` },
    description: alerta.message,
  };

  const communication: Communication = {
    resourceType: 'Communication',
    // 'in-progress' = sin leer: el panel filtra status !== 'completed'.
    status: 'in-progress',
    category: [CATEGORIA_ALERTA],
    subject,
    sent: fecha,
    payload: [{ contentString: alerta.message }],
  };

  const entries: BundleEntry[] = [issue, task, communication].map((r) => ({
    resource: r,
    request: { method: 'POST', url: r.resourceType },
  }));
  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
}

/**
 * Evalúa las reglas para un paciente y crea los recursos de las que disparan
 * y no están en cooldown. Devuelve los ids de regla creados (para tests y
 * para el log del bot).
 */
export async function evaluarYAlertar(medplum: MedplumClient, patient: Patient, ahora = new Date()): Promise<string[]> {
  const patientId = patient.id as string;
  const history = await getCKMObservationHistory(medplum, patientId);
  const disparadas = evaluateThresholdRules(history, sexoDe(patient));
  if (disparadas.length === 0) {
    return [];
  }

  // Una sola búsqueda de DetectedIssue previos alcanza para todas las reglas.
  const previos = await medplum.searchResources('DetectedIssue', {
    patient: `Patient/${patientId}`,
    _count: '100',
    _sort: '-_lastUpdated',
  });

  const creadas: string[] = [];
  for (const alerta of disparadas) {
    if (enCooldown(previos as DetectedIssue[], alerta.ruleId, ahora)) {
      continue;
    }
    await medplum.executeBatch(recursosDeAlerta(alerta, patientId, ahora));
    creadas.push(alerta.ruleId);
  }
  return creadas;
}

export async function handler(medplum: MedplumClient, event: BotEvent<Observation>): Promise<string[]> {
  const observation = event.input;

  // Mismo filtro que ckm-recalculate: solo Observations de parámetros CKM.
  const values = extractCKMValues(observation);
  const patientId = observation.subject?.reference?.match(/^Patient\/(.+)$/)?.[1];
  if (!patientId || Object.keys(values).length === 0) {
    return [];
  }

  const patient = await medplum.readResource('Patient', patientId);
  return evaluarYAlertar(medplum, patient);
}

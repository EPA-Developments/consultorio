// Bot CKM: recalcula las métricas del hGraph, el estadío CKM y los 3 scores
// PREVENT (ASCVD 10a, IC 10a, ECV total 30a) del paciente cuando llega una
// Observation nueva o editada con algún parámetro CKM.
//
// Se despliega con una Subscription cuyo criteria filtra por los códigos LOINC
// CKM (ver deploy-bots.ts). Flujo:
// 1. Extrae el paciente de la Observation recibida (ignora si no es CKM).
// 2. Relee todas las Observations CKM y se queda con el último valor de cada
//    parámetro (acepta el panel de PA 85354-9 y la forma legacy separada).
// 3. Calcula métricas/estadío y los scores PREVENT (si hay datos suficientes).
// 4. Persiste las extensiones CKMStage y hGraphData del Patient.
//
// SOLO recálculo. Las notificaciones (alertas de estadío/valores críticos,
// tendencias, email al médico) se sacaron a propósito: son features secundarias
// y frágiles (dependen de SES) que no deben poder interrumpir el recálculo.
// Volverán en una etapa futura, aisladas en su propio bot/handler.
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Condition, Observation, Patient } from '@medplum/fhirtypes';
import type { CKMObservationMap } from '../../ckm/observations';
import type { PREVENTScores } from '../../ckm/types';
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
import { extractCKMValues, getLatestCKMObservations } from '../../ckm/observations';
import { buildPreventInputs, computePrevent } from '../../ckm/prevent';
import { computeMetrics, deriveStage } from '../../ckm/scoring';

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
 * Recalcula y persiste las extensiones CKM (métricas hGraph, estadío, scores
 * PREVENT) de un paciente a partir de sus últimas Observations. Si el paciente
 * no tiene datos CKM ni un cálculo previo, no escribe nada.
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

  // Sin datos CKM ni cálculo previo: nada que recalcular (evita escrituras vacías
  // en pacientes que no son del programa CKM).
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
  // Si no quedan datos evaluables, conservar el estadío previo en lugar de borrarlo.
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

  // Solo reaccionar a Observations de parámetros CKM con sujeto Patient.
  const triggeredValues = extractCKMValues(observation);
  const patientId = observation.subject?.reference?.match(/^Patient\/(.+)$/)?.[1];
  if (!patientId || Object.keys(triggeredValues).length === 0) {
    return undefined;
  }

  const patient = await medplum.readResource('Patient', patientId);
  return recomputeCKM(medplum, patient);
}

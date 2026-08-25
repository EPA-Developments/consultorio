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
import type { Observation, Patient } from '@medplum/fhirtypes';
import { isActiveCondition } from '../../ckm/clinical';
import { computeCKMSnapshot } from '../../ckm/compute';
import { getCKMStage, getHGraphData, withCKMExtensions } from '../../ckm/extensions';
import { extractCKMValues, getLatestCKMObservations } from '../../ckm/observations';

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
    console.log(`[ckm] ${patientId}: sin datos CKM ni cálculo previo — no escribe`);
    return patient;
  }

  const medications = await medplum.searchResources('MedicationRequest', {
    subject: `Patient/${patientId}`,
    status: 'active',
    _count: '100',
  });

  // El cálculo vive en ckm/compute.ts, compartido con la UI: así el panel del
  // chart y lo que persiste el bot no pueden dar números distintos.
  const snapshot = computeCKMSnapshot(values, patient, active, medications);

  // Si no quedan datos evaluables (ej. lectura vacía o única lectura descartada),
  // conservar lo previo en lugar de borrarlo. Evita que una corrida con búsqueda
  // vacía (lag de indexación, política de acceso, etc.) pise datos buenos.
  const metrics = snapshot.metrics.length > 0 ? snapshot.metrics : (previous.metrics ?? []);
  const stage = snapshot.stage ?? previousStage;
  const prevent = snapshot.prevent ?? previous.prevent;

  // Una línea por ejecución. Medplum guarda la salida del bot en
  // AuditEvent.outcomeDesc, así que esto es lo único que deja ver QUÉ vio el
  // bot cuando lo dispara una Subscription: por dentro del Lambda no hay
  // depurador, y un bot que sale sin escribir es indistinguible de uno que no
  // corrió. Cuenta recursos, no valores: nada de esto es dato clínico.
  console.log(
    `[ckm] ${patientId}: obs=${Object.keys(values).length} cond=${active.length} med=${medications.length}` +
      ` previo(metrics=${previous.metrics?.length ?? 'no'} stage=${previousStage ?? 'no'})` +
      ` -> metrics=${metrics.length} stage=${stage ?? 'no'} prevent=${prevent ? 'sí' : 'no'}`
  );

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
    console.log(
      `[ckm] Observation/${observation.id ?? '?'} ignorada:` +
        ` sujeto=${observation.subject?.reference ?? 'sin sujeto'} params=${Object.keys(triggeredValues).length}`
    );
    return undefined;
  }

  const patient = await medplum.readResource('Patient', patientId);
  return recomputeCKM(medplum, patient);
}

// Cálculo CKM completo a partir de los recursos ya leídos: métricas del hGraph,
// estadío CKM y scores PREVENT.
//
// Es la ÚNICA definición de "cómo se calcula el CKM", compartida por:
// - el bot `ckm-recalculate` (que además lo persiste en el Patient), y
// - la UI del chart, que puede calcularlo en vivo cuando el bot todavía no
//   escribió nada (servidor sin entrega de Subscriptions, alta reciente, etc.).
//
// Tenerlo en un solo lugar evita que el panel y el bot se desincronicen y
// muestren números distintos para el mismo paciente.
import type { Condition, MedicationRequest, Patient } from '@medplum/fhirtypes';
import {
  ageFromBirthDate,
  deriveMedicationFlags,
  hasDiabetes,
  hasSmoking,
  isClinicalCVD,
  patientPreventSex,
} from './clinical';
import type { CKMObservationMap } from './observations';
import { buildPreventInputs, computePrevent } from './prevent';
import { computeMetrics, deriveStage } from './scoring';
import type { CKMStage, HGraphMetric, PREVENTScores } from './types';

/** Resultado del cálculo CKM de un paciente. */
export interface CKMSnapshot {
  metrics: HGraphMetric[];
  stage?: CKMStage;
  prevent?: PREVENTScores;
}

/**
 * Calcula métricas, estadío y scores PREVENT. Puro: recibe todo ya leído del
 * servidor y no escribe nada.
 *
 * @param values - Últimos valores observados de los parámetros CKM.
 * @param patient - Paciente (aporta sexo y fecha de nacimiento).
 * @param activeConditions - Conditions ACTIVAS (ya filtradas por isActiveCondition).
 * @param medications - MedicationRequest activas (estatinas / antihipertensivos).
 */
export function computeCKMSnapshot(
  values: CKMObservationMap,
  patient: Patient,
  activeConditions: Condition[],
  medications: MedicationRequest[]
): CKMSnapshot {
  const hasClinicalCVD = activeConditions.some(isClinicalCVD);
  const metrics = computeMetrics(values);
  const stage = deriveStage(values, { hasClinicalCVD, gender: patient.gender });

  return { metrics, stage, prevent: computePreventFor(values, patient, activeConditions, medications) };
}

/**
 * Scores PREVENT del paciente. Devuelve undefined si falta algún insumo o si
 * los coeficientes no están verificados (lo decide computePrevent).
 */
export function computePreventFor(
  values: CKMObservationMap,
  patient: Patient,
  activeConditions: Condition[],
  medications: MedicationRequest[]
): PREVENTScores | undefined {
  const sex = patientPreventSex(patient);
  if (!sex) {
    return undefined;
  }
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

// Lectura unificada de las Observations CKM, sin importar el rol que las cargó.
//
// Contrato de registro (rol paciente en Control y rol médico acá):
// - Presión arterial: una sola Observation LOINC 85354-9 con componentes
//   8480-6 (sistólica) y 8462-4 (diastólica) — forma canónica US Core.
// - Resto de parámetros: una Observation por parámetro con el código del
//   objeto LOINC de constants.ts y valueQuantity.
//
// Este lector además tolera la forma legacy de presión arterial como dos
// Observations separadas (8480-6 y 8462-4 sueltas), para no perder datos
// históricos cargados antes de la unificación.
import type { MedplumClient } from '@medplum/core';
import type { Observation } from '@medplum/fhirtypes';
import { LOINC, LOINC_BP_PANEL, LOINC_SYNONYMS, LOINC_SYSTEM } from './constants';
import type { CKMParameterId } from './constants';

export interface CKMObservationValue {
  value: number;
  unit?: string;
  /** Fecha clínica de la medición (effectiveDateTime). */
  date?: string;
}

export type CKMObservationMap = Partial<Record<CKMParameterId, CKMObservationValue>>;

// Mapa código LOINC → parámetro CKM, incluyendo los sinónimos que usan distintos
// laboratorios (ej. eGFR CKD-EPI 2021, LDL medido) para el mismo parámetro.
const CODE_TO_PARAM = new Map<string, CKMParameterId>(
  (Object.entries(LOINC) as [CKMParameterId, string][]).map(([param, code]) => [code, param])
);
for (const [param, codes] of Object.entries(LOINC_SYNONYMS) as [CKMParameterId, string[]][]) {
  for (const code of codes) {
    CODE_TO_PARAM.set(code, param);
  }
}

/** Todos los códigos LOINC a buscar (primarios + sinónimos + panel de PA). */
export const CKM_OBSERVATION_CODES: string[] = [
  ...Object.values(LOINC),
  ...Object.values(LOINC_SYNONYMS).flat(),
  LOINC_BP_PANEL,
];

function hasCode(codes: { coding?: { system?: string; code?: string }[] } | undefined, code: string): boolean {
  return Boolean(codes?.coding?.some((c) => c.code === code && (!c.system || c.system === LOINC_SYSTEM)));
}

function observationDate(observation: Observation): string {
  return observation.effectiveDateTime ?? observation.issued ?? observation.meta?.lastUpdated ?? '';
}

/**
 * Extrae los valores CKM de una Observation, en cualquiera de las dos formas:
 * panel de presión arterial (componentes) u Observation individual.
 */
export function extractCKMValues(observation: Observation): CKMObservationMap {
  const result: CKMObservationMap = {};
  const date = observationDate(observation) || undefined;

  // Componentes (panel 85354-9 o cualquier Observation con components)
  for (const component of observation.component ?? []) {
    for (const [code, param] of CODE_TO_PARAM) {
      if (hasCode(component.code, code) && component.valueQuantity?.value !== undefined) {
        result[param] = { value: component.valueQuantity.value, unit: component.valueQuantity.unit, date };
      }
    }
  }

  // Observation individual con valueQuantity
  if (observation.valueQuantity?.value !== undefined) {
    for (const [code, param] of CODE_TO_PARAM) {
      if (hasCode(observation.code, code)) {
        result[param] = { value: observation.valueQuantity.value, unit: observation.valueQuantity.unit, date };
      }
    }
  }

  return result;
}

/**
 * Una lectura de PA con sistólica <= diastólica es fisiológicamente imposible:
 * casi siempre es una carga con los campos cruzados (ej. 87/160 en Control).
 */
export function isImplausibleBloodPressure(values: CKMObservationMap): boolean {
  return values.sbp !== undefined && values.dbp !== undefined && values.sbp.value <= values.dbp.value;
}

/**
 * Reduce una lista de Observations al último valor de cada parámetro CKM.
 * Las Observations se procesan de más vieja a más nueva, así la más reciente
 * (por fecha clínica) pisa a las anteriores. Las lecturas de PA implausibles
 * (sistólica <= diastólica) se descartan para no pisar valores válidos.
 */
export function latestCKMValues(observations: Observation[]): CKMObservationMap {
  const sorted = [...observations].sort((a, b) => observationDate(a).localeCompare(observationDate(b)));
  const result: CKMObservationMap = {};
  for (const observation of sorted) {
    const values = extractCKMValues(observation);
    if (isImplausibleBloodPressure(values)) {
      delete values.sbp;
      delete values.dbp;
    }
    Object.assign(result, values);
  }
  return result;
}

/**
 * Busca en el servidor las Observations CKM del paciente y devuelve el último
 * valor de cada parámetro, sin importar desde qué rol/app se cargaron.
 */
export async function getLatestCKMObservations(medplum: MedplumClient, patientId: string): Promise<CKMObservationMap> {
  const observations = await medplum.searchResources('Observation', {
    subject: `Patient/${patientId}`,
    code: CKM_OBSERVATION_CODES.join(','),
    _sort: '-date',
    _count: '500',
  });
  return latestCKMValues(observations.filter((o) => o.status !== 'entered-in-error'));
}

/** Historial de un parámetro CKM: todas sus lecturas, de más nueva a más vieja. */
export type CKMObservationHistory = Partial<Record<CKMParameterId, CKMObservationValue[]>>;

/**
 * Agrupa una lista de Observations por parámetro CKM conservando todas las
 * lecturas (no solo la última), ordenadas de más nueva a más vieja. Descarta
 * las lecturas de PA implausibles (sistólica <= diastólica).
 */
export function groupCKMValues(observations: Observation[]): CKMObservationHistory {
  const sorted = [...observations].sort((a, b) => observationDate(b).localeCompare(observationDate(a)));
  const result: CKMObservationHistory = {};
  for (const observation of sorted) {
    const values = extractCKMValues(observation);
    if (isImplausibleBloodPressure(values)) {
      delete values.sbp;
      delete values.dbp;
    }
    for (const [param, value] of Object.entries(values) as [CKMParameterId, CKMObservationValue][]) {
      (result[param] ??= []).push(value);
    }
  }
  return result;
}

/**
 * Busca las Observations CKM del paciente y devuelve el historial por
 * parámetro (todas las lecturas), para evaluar tendencias/reglas de alerta.
 */
export async function getCKMObservationHistory(
  medplum: MedplumClient,
  patientId: string
): Promise<CKMObservationHistory> {
  const observations = await medplum.searchResources('Observation', {
    subject: `Patient/${patientId}`,
    code: CKM_OBSERVATION_CODES.join(','),
    _sort: '-date',
    _count: '500',
  });
  return groupCKMValues(observations.filter((o) => o.status !== 'entered-in-error'));
}

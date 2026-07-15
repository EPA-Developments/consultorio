// Potenciadores de riesgo CV ("risk enhancers" ACC/AHA) del panel BioHacking.
//
// Marcadores que, elevados, aumentan el riesgo más allá del score PREVENT y
// pueden justificar tratamiento más intensivo aunque el riesgo calculado sea
// limítrofe/intermedio. Etapa 3 (display-only): se LEEN y se MUESTRAN junto a
// los scores, NO modifican el cálculo de PREVENT.
//
// Los umbrales provienen del bundle de ObservationDefinitions de BioWellness
// (rango óptimo / convencional). Acá están hardcodeados; una etapa posterior
// podría leerlos dinámicamente de las ObservationDefinitions cargadas en
// Medplum. Sin dependencias de UI: usable por el FrontEnd y por los bots.
import type { Observation } from '@medplum/fhirtypes';
import { LOINC_SYSTEM } from './constants';
import type { BiomarkerDefinition } from './observation-definitions';

/** Nivel cualitativo de un potenciador, de mejor a peor. */
export type EnhancerLevel = 'optimal' | 'borderline' | 'high';

export interface EnhancerLevelInfo {
  level: EnhancerLevel;
  /** Etiqueta para mostrar, en español. */
  label: string;
  /** Color de la paleta de Mantine. */
  color: string;
}

export interface EnhancerDefinition {
  id: string;
  label: string;
  loinc: string;
  /**
   * Sinónimos LOINC aceptados en la lectura además del primario, para la MISMA
   * unidad. Distintos laboratorios codifican el mismo analito con LOINC
   * diferentes (Lp(a) es el caso típico: molar 102725-2 vs 43583-4).
   */
  altLoinc?: string[];
  unit: string;
  /** value < optimalBelow ⇒ óptimo. */
  optimalBelow: number;
  /** optimalBelow ≤ value < conventionalBelow ⇒ límite; value ≥ conventionalBelow ⇒ elevado. */
  conventionalBelow: number;
  /** Interpretación clínica (tooltip), tomada del JSON de biomarcadores. */
  interpretation: string;
  /** Fuente del rango / interpretación. */
  source: string;
}

/**
 * Registro de potenciadores de la Etapa 3. Umbrales del JSON de BioWellness:
 * - ApoB: óptimo < 90 mg/dL, convencional < 130 mg/dL.
 * - Lp(a): óptimo < 50 nmol/L, convencional < 75 nmol/L.
 */
export const RISK_ENHANCERS: EnhancerDefinition[] = [
  {
    id: 'apob',
    label: 'ApoB',
    loinc: '1884-6',
    unit: 'mg/dL',
    optimalBelow: 90,
    conventionalBelow: 130,
    interpretation:
      'Mejor predictor de riesgo cardiovascular: cuenta TODAS las partículas aterogénicas (LDL, IDL, VLDL, Lp(a)). Más preciso que el LDL-C.',
    source: 'Attia, Outlive; Bryan Johnson, Blueprint',
  },
  {
    id: 'lpa',
    label: 'Lp(a)',
    loinc: '102725-2',
    // Lp(a) tiene doble codificación MOLAR (nmol/L): 102725-2 (LOINC actual) y
    // 43583-4 (clásico, el que usan muchos laboratorios). Ambos comparten unidad
    // y umbrales, así que se aceptan los dos. NO se incluye el código de MASA
    // 10835-7 (mg/dL): usa otra escala y descolocaría la clasificación.
    altLoinc: ['43583-4'],
    unit: 'nmol/L',
    optimalBelow: 50,
    conventionalBelow: 75,
    interpretation:
      'Factor de riesgo genéticamente determinado, no modificable por dieta. Su elevación requiere estrategia farmacológica; se mide al menos una vez en la vida.',
    source: 'Attia, Outlive; Bryan Johnson, Blueprint',
  },
];

const LEVEL_INFO: Record<EnhancerLevel, EnhancerLevelInfo> = {
  optimal: { level: 'optimal', label: 'Óptimo', color: 'green' },
  borderline: { level: 'borderline', label: 'Límite', color: 'yellow' },
  high: { level: 'high', label: 'Elevado', color: 'red' },
};

/** Clasifica un valor según los umbrales óptimo/convencional del potenciador. */
export function classifyEnhancer(def: EnhancerDefinition, value: number): EnhancerLevelInfo {
  if (!Number.isFinite(value) || value < def.optimalBelow) {
    return LEVEL_INFO.optimal;
  }
  if (value < def.conventionalBelow) {
    return LEVEL_INFO.borderline;
  }
  return LEVEL_INFO.high;
}

/**
 * Definición efectiva del potenciador: si hay una ObservationDefinition cargada
 * para su LOINC, toma de ahí los umbrales (óptimo/convencional), la unidad, la
 * interpretación y la fuente; si no, usa el hardcode. Así los rangos salen de la
 * fuente de verdad FHIR cuando está disponible, con fallback al default.
 */
export function resolveEnhancer(base: EnhancerDefinition, od?: BiomarkerDefinition): EnhancerDefinition {
  if (!od) {
    return base;
  }
  const optimalHigh = od.optimal.find((r) => !r.gender)?.high ?? od.optimal[0]?.high;
  const conventionalHigh = od.conventional.find((r) => !r.gender)?.high ?? od.conventional[0]?.high;
  return {
    ...base,
    optimalBelow: optimalHigh ?? base.optimalBelow,
    conventionalBelow: conventionalHigh ?? base.conventionalBelow,
    unit: od.unit ?? base.unit,
    interpretation: od.interpretation ?? base.interpretation,
    source: od.source ?? base.source,
  };
}

/** Una lectura clasificada de un potenciador para un paciente. */
export interface EnhancerReading {
  def: EnhancerDefinition;
  value: number;
  unit?: string;
  info: EnhancerLevelInfo;
}

function observationDate(observation: Observation): string {
  return observation.effectiveDateTime ?? observation.issued ?? observation.meta?.lastUpdated ?? '';
}

function hasLoinc(observation: Observation, code: string): boolean {
  return Boolean(
    observation.code?.coding?.some((c) => c.code === code && (!c.system || c.system === LOINC_SYSTEM))
  );
}

/** Códigos LOINC aceptados para un potenciador (primario + sinónimos). */
export function enhancerLoincCodes(def: EnhancerDefinition): string[] {
  return def.altLoinc?.length ? [def.loinc, ...def.altLoinc] : [def.loinc];
}

/** Códigos LOINC de todos los potenciadores (para la query de Observations). */
export const ENHANCER_LOINC_CODES: string[] = RISK_ENHANCERS.flatMap(enhancerLoincCodes);

/**
 * Reduce una lista de Observations a la última lectura clasificada de cada
 * potenciador. Si se pasa el índice de ObservationDefinitions (por LOINC), los
 * umbrales salen de ahí (fuente de verdad FHIR); si no, del hardcode. Descarta
 * las marcadas entered-in-error y las que no tienen valueQuantity. Devuelve
 * solo los potenciadores con dato (en el orden de RISK_ENHANCERS).
 */
export function readEnhancers(
  observations: Observation[],
  dynamicByLoinc?: Map<string, BiomarkerDefinition>
): EnhancerReading[] {
  const newestFirst = [...observations].sort((a, b) => observationDate(b).localeCompare(observationDate(a)));
  const readings: EnhancerReading[] = [];
  for (const base of RISK_ENHANCERS) {
    const def = resolveEnhancer(base, dynamicByLoinc?.get(base.loinc));
    const codes = enhancerLoincCodes(def);
    const obs = newestFirst.find(
      (o) =>
        o.status !== 'entered-in-error' &&
        codes.some((c) => hasLoinc(o, c)) &&
        o.valueQuantity?.value !== undefined
    );
    if (obs?.valueQuantity?.value !== undefined) {
      const value = obs.valueQuantity.value;
      readings.push({ def, value, unit: obs.valueQuantity.unit, info: classifyEnhancer(def, value) });
    }
  }
  return readings;
}

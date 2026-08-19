// Potenciadores de riesgo CV ("risk enhancers" ACC/AHA) del panel BioHacking.
//
// Marcadores que, elevados, aumentan el riesgo más allá del score PREVENT y
// pueden justificar tratamiento más intensivo aunque el riesgo calculado sea
// limítrofe/intermedio. Etapa 3 (display-only): se LEEN y se MUESTRAN junto a
// los scores, NO modifican el cálculo de PREVENT.
//
// Los umbrales provienen del bundle de ObservationDefinitions del catálogo
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

/** Umbrales de una escala de medición (una unidad). value < optimalBelow ⇒ óptimo. */
export interface EnhancerScale {
  /** Código LOINC de esta escala (para inferir la unidad si la Observation no la trae). */
  loinc: string;
  /** Unidad canónica de la escala. */
  unit: string;
  optimalBelow: number;
  conventionalBelow: number;
}

export interface EnhancerDefinition {
  id: string;
  label: string;
  loinc: string;
  /**
   * Sinónimos LOINC de la MISMA escala/unidad que el primario. Distintos
   * laboratorios codifican el mismo analito con LOINC diferentes: Lp(a) molar
   * es 102725-2 (actual) o 43583-4 (clásico), ambos en nmol/L.
   */
  altLoinc?: string[];
  unit: string;
  /** value < optimalBelow ⇒ óptimo. */
  optimalBelow: number;
  /** optimalBelow ≤ value < conventionalBelow ⇒ límite; value ≥ conventionalBelow ⇒ elevado. */
  conventionalBelow: number;
  /**
   * Escala ALTERNATIVA por unidad, para analitos con doble unidad. Lp(a) se
   * reporta en molar (nmol/L) o en masa (mg/dL, LOINC 10835-7), que NO son
   * intercambiables (la conversión depende del tamaño de partícula). La lectura
   * clasifica según la unidad REAL de la Observation para no confundir escalas.
   */
  massScale?: EnhancerScale;
  /** Interpretación clínica (tooltip), tomada del JSON de biomarcadores. */
  interpretation: string;
  /** Fuente del rango / interpretación. */
  source: string;
}

/**
 * Registro de potenciadores de la Etapa 3. Umbrales del JSON del catálogo:
 * - ApoB: óptimo < 90 mg/dL, convencional < 130 mg/dL.
 * - Lp(a): óptimo < 50 nmol/L, convencional < 75 nmol/L (molar); en masa
 *   óptimo < 30 mg/dL, convencional < 50 mg/dL (cutoffs clínicos estándar).
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
    // Lp(a) MOLAR (nmol/L): 102725-2 (LOINC actual) y 43583-4 (clásico). Muchos
    // laboratorios usan el clásico; algunos incluso codifican con el código de
    // masa 10835-7 pero reportan el valor en nmol/L. Por eso la clasificación se
    // decide por la UNIDAD de la Observation, no por el código (ver massScale).
    altLoinc: ['43583-4'],
    unit: 'nmol/L',
    optimalBelow: 50,
    conventionalBelow: 75,
    // Lp(a) en MASA (mg/dL), LOINC 10835-7. Cutoffs clínicos estándar.
    massScale: { loinc: '10835-7', unit: 'mg/dL', optimalBelow: 30, conventionalBelow: 50 },
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

/** Clasifica un valor contra umbrales óptimo/convencional. */
export function classifyThresholds(optimalBelow: number, conventionalBelow: number, value: number): EnhancerLevelInfo {
  if (!Number.isFinite(value) || value < optimalBelow) {
    return LEVEL_INFO.optimal;
  }
  if (value < conventionalBelow) {
    return LEVEL_INFO.borderline;
  }
  return LEVEL_INFO.high;
}

/** Clasifica un valor según los umbrales óptimo/convencional del potenciador. */
export function classifyEnhancer(def: EnhancerDefinition, value: number): EnhancerLevelInfo {
  return classifyThresholds(def.optimalBelow, def.conventionalBelow, value);
}

/**
 * Definición efectiva del potenciador: si hay una ObservationDefinition cargada
 * para su LOINC, toma de ahí los umbrales (óptimo/convencional), la unidad, la
 * interpretación y la fuente; si no, usa el hardcode. Así los rangos salen de la
 * fuente de verdad FHIR cuando está disponible, con fallback al default. (La OD
 * es molar; la escala de masa de Lp(a) siempre usa el hardcode.)
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

/** Códigos LOINC aceptados para un potenciador (primario + sinónimos + escala de masa). */
export function enhancerLoincCodes(def: EnhancerDefinition): string[] {
  const codes = [def.loinc, ...(def.altLoinc ?? [])];
  if (def.massScale) {
    codes.push(def.massScale.loinc);
  }
  return codes;
}

/** Códigos LOINC de todos los potenciadores (para la query de Observations). */
export const ENHANCER_LOINC_CODES: string[] = RISK_ENHANCERS.flatMap(enhancerLoincCodes);

const MASS_UNIT_RE = /mg\s*\/?\s*d?l|mg%/i;
const MOLAR_UNIT_RE = /nmol/i;

/**
 * Elige la escala (umbrales + unidad) para clasificar una Observation. Prioriza
 * la UNIDAD real de la Observation (autoritativa sobre el valor); si no la trae,
 * cae al código que matcheó. Así un valor molar codificado con el LOINC de masa
 * (o viceversa) se clasifica por su unidad verdadera, evitando falsos "óptimo".
 */
export function scaleForObservation(
  def: EnhancerDefinition,
  observationUnit: string | undefined,
  matchedCode: string | undefined
): { unit: string; optimalBelow: number; conventionalBelow: number } {
  const primary = { unit: def.unit, optimalBelow: def.optimalBelow, conventionalBelow: def.conventionalBelow };
  if (!def.massScale) {
    return primary;
  }
  const mass = {
    unit: def.massScale.unit,
    optimalBelow: def.massScale.optimalBelow,
    conventionalBelow: def.massScale.conventionalBelow,
  };
  const u = observationUnit ?? '';
  if (MASS_UNIT_RE.test(u)) {
    return mass;
  }
  if (MOLAR_UNIT_RE.test(u)) {
    return primary;
  }
  // Sin unidad reconocible: inferir por el código que matcheó.
  return matchedCode === def.massScale.loinc ? mass : primary;
}

/**
 * Reduce una lista de Observations a la última lectura clasificada de cada
 * potenciador. Si se pasa el índice de ObservationDefinitions (por LOINC), los
 * umbrales salen de ahí (fuente de verdad FHIR); si no, del hardcode. Clasifica
 * según la unidad real de cada Observation (molar vs masa en Lp(a)). Descarta
 * las marcadas entered-in-error y las que no tienen valueQuantity. Devuelve solo
 * los potenciadores con dato (en el orden de RISK_ENHANCERS).
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
      const matchedCode = codes.find((c) => hasLoinc(obs, c));
      const scale = scaleForObservation(def, obs.valueQuantity.unit, matchedCode);
      const effDef: EnhancerDefinition = { ...def, ...scale };
      readings.push({
        def: effDef,
        value,
        unit: obs.valueQuantity.unit ?? scale.unit,
        info: classifyThresholds(scale.optimalBelow, scale.conventionalBelow, value),
      });
    }
  }
  return readings;
}

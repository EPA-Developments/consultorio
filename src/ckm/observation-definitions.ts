// Lector del panel de biomarcadores desde sus ObservationDefinitions
// (fuente de verdad FHIR cargada con upload-biomarker-definitions).
//
// Cada ObservationDefinition trae: identifier (slug del biomarcador), code
// (LOINC o código local), category (panel: metabolico/lipidico/inflamacion/…),
// unidad, rangos por contexto (convencional u óptimo, opcionalmente por
// género — ver RANGE_CONTEXT_CODES) y extensiones de texto (rango convencional/
// óptimo, interpretación, fuente). Este módulo las normaliza a una forma plana
// y fácil de consumir. Sin dependencias de UI.
import type { MedplumClient } from '@medplum/core';
import type { Observation, ObservationDefinition } from '@medplum/fhirtypes';

export const BIOMARCADOR_IDENTIFIER_SYSTEM = 'https://bio.medplum.com.ar/fhir/sid/biomarcador';
export const PANEL_SYSTEM = 'https://bio.medplum.com.ar/fhir/CodeSystem/panel-biomarcador';
export const CONTEXTO_RANGO_SYSTEM = 'https://bio.medplum.com.ar/fhir/CodeSystem/contexto-rango';
const EXT_BASE = 'https://bio.medplum.com.ar/fhir/StructureDefinition/';
export const EXT_RANGO_CONVENCIONAL_TEXTO = EXT_BASE + 'rango-convencional-texto';
export const EXT_RANGO_OPTIMO_TEXTO = EXT_BASE + 'rango-optimo-texto';
export const EXT_INTERPRETACION = EXT_BASE + 'interpretacion';
export const EXT_FUENTE = EXT_BASE + 'fuente';

/**
 * Estas dos usan OTRA base (`biowellness.ar`, no `bio.medplum.com.ar`). Las
 * escribe el catálogo así; no es un error de tipeo acá. Son identificadores de
 * datos vivos y NO se renombran con la marca (ver docs/MARCA-Y-PLATAFORMA.md):
 * si algún día se unifican, se cambia en el catálogo primero, no en el lector.
 */
const EXT_BASE_CATALOGO = 'https://biowellness.ar/fhir/StructureDefinition/';
/** El catálogo marca acá lo que no se pide suelto: derivados y componentes de panel. */
export const EXT_NO_SOLICITABLE = EXT_BASE_CATALOGO + 'no-solicitable';
/** Presente solo en los calculados; su valor es la fórmula en prosa. */
export const EXT_FORMULA_DERIVADO = EXT_BASE_CATALOGO + 'formula-derivado';
export const LOINC_SYSTEM = 'http://loinc.org';

/** Contexto de un rango: convencional u óptimo. */
export type RangeContext = 'conventional' | 'optimal';

/**
 * Códigos con los que el catálogo marca cada tipo de rango. Hay dos por el
 * convencional porque el catálogo tiene dos generaciones de definiciones: las
 * primeras usan 'normal' y las que se sumaron después usan 'convencional'.
 * Leer una sola dejaba sin rango convencional a la mayoría del panel, y con
 * ello el valor se clasificaba contra el rango óptimo (mucho más angosto),
 * marcando como alto/bajo lo que en realidad estaba dentro de referencia.
 */
const RANGE_CONTEXT_CODES: Record<RangeContext, string[]> = {
  conventional: ['normal', 'convencional'],
  optimal: ['funcional-optimo'],
};

export interface BiomarkerRange {
  low?: number;
  high?: number;
  /** 'male' | 'female' si el rango es específico por género; ausente si aplica a ambos. */
  gender?: string;
  /**
   * Edad en años a la que aplica el rango; ausente si aplica a cualquier edad.
   * Lo usa, por ejemplo, la testosterona libre en mujeres, donde el rango
   * premenopáusico y el posmenopáusico son distintos.
   */
  ageMin?: number;
  ageMax?: number;
}

/** Forma normalizada de una ObservationDefinition de biomarcador. */
export interface BiomarkerDefinition {
  /** Slug del biomarcador (identifier en BIOMARCADOR_IDENTIFIER_SYSTEM). */
  biomarcadorId?: string;
  /** Nombre para mostrar (code.text). */
  label: string;
  /** Código (LOINC o local). */
  code?: string;
  system?: string;
  /** Código del panel (metabolico, lipidico, inflamacion, …). */
  panelCode?: string;
  panelDisplay?: string;
  unit?: string;
  conventionalText?: string;
  optimalText?: string;
  interpretation?: string;
  source?: string;
  /**
   * El catálogo dice que este marcador no se pide suelto. Es la fuente de
   * verdad de la solicitabilidad: mantener una lista paralela en el código se
   * desincroniza, y el precio de desincronizarse acá es una orden que llega al
   * laboratorio pidiendo un estudio que no existe.
   */
  noSolicitable?: boolean;
  /** Fórmula, en prosa, de los marcadores que son un cálculo. */
  formulaDerivado?: string;
  /** Rangos convencionales (contexto 'normal'); puede haber uno por género. */
  conventional: BiomarkerRange[];
  /** Rangos óptimos (contexto 'funcional-optimo'). */
  optimal: BiomarkerRange[];
}

function extString(od: ObservationDefinition, url: string): string | undefined {
  return od.extension?.find((e) => e.url === url)?.valueString;
}

function extBoolean(od: ObservationDefinition, url: string): boolean | undefined {
  return od.extension?.find((e) => e.url === url)?.valueBoolean;
}

function intervalsForContext(od: ObservationDefinition, context: RangeContext): BiomarkerRange[] {
  const codes = RANGE_CONTEXT_CODES[context];
  return (od.qualifiedInterval ?? [])
    .filter((q) => q.context?.coding?.some((c) => c.code && codes.includes(c.code)))
    .map((q) => ({
      low: q.range?.low?.value,
      high: q.range?.high?.value,
      gender: q.gender,
      ageMin: q.age?.low?.value,
      ageMax: q.age?.high?.value,
    }));
}

/** Normaliza una ObservationDefinition de biomarcador a BiomarkerDefinition. */
export function parseObservationDefinition(od: ObservationDefinition): BiomarkerDefinition {
  const coding = od.code?.coding?.[0];
  const unit = od.quantitativeDetails?.unit;
  return {
    biomarcadorId: od.identifier?.find((i) => i.system === BIOMARCADOR_IDENTIFIER_SYSTEM)?.value,
    label: od.code?.text ?? coding?.display ?? coding?.code ?? '(sin nombre)',
    code: coding?.code,
    system: coding?.system,
    panelCode: od.category?.[0]?.coding?.[0]?.code,
    panelDisplay: od.category?.[0]?.coding?.[0]?.display,
    unit: unit?.text ?? unit?.coding?.[0]?.code,
    conventionalText: extString(od, EXT_RANGO_CONVENCIONAL_TEXTO),
    optimalText: extString(od, EXT_RANGO_OPTIMO_TEXTO),
    interpretation: extString(od, EXT_INTERPRETACION),
    source: extString(od, EXT_FUENTE),
    noSolicitable: extBoolean(od, EXT_NO_SOLICITABLE),
    formulaDerivado: extString(od, EXT_FORMULA_DERIVADO),
    conventional: intervalsForContext(od, 'conventional'),
    optimal: intervalsForContext(od, 'optimal'),
  };
}

function matchesAge(r: BiomarkerRange, ageYears?: number): boolean {
  if (r.ageMin === undefined && r.ageMax === undefined) {
    return true;
  }
  if (ageYears === undefined) {
    return false;
  }
  return (r.ageMin === undefined || ageYears >= r.ageMin) && (r.ageMax === undefined || ageYears <= r.ageMax);
}

/**
 * Elige el rango aplicable a un paciente. Va de lo más específico a lo más
 * general: género + edad, después género, después edad, después el rango sin
 * calificar, y como último recurso el primero de la lista.
 *
 * El orden importa: si un biomarcador trae dos rangos para el mismo género que
 * se distinguen solo por la edad (testosterona libre en mujeres, pre y
 * posmenopausia), quedarse con el primero que matchea el género elegiría el
 * premenopáusico para una paciente de 60.
 */
export function rangeFor(ranges: BiomarkerRange[], gender?: string, ageYears?: number): BiomarkerRange | undefined {
  if (ranges.length === 0) {
    return undefined;
  }
  const aplica = (r: BiomarkerRange): boolean => matchesAge(r, ageYears);

  if (gender) {
    const delGenero = ranges.filter((r) => r.gender === gender);
    if (delGenero.length > 0) {
      // Si el biomarcador tiene rangos propios del género, la elección se hace
      // DENTRO de ese grupo. Cuando ninguno cubre la edad no hay rango
      // aplicable, y eso se informa como "sin dato": es preferible a mostrar el
      // rango de otra franja etaria como si fuera el de la paciente.
      return delGenero.find(aplica);
    }
  }
  const sinGenero = ranges.filter((r) => !r.gender);
  if (sinGenero.length > 0) {
    return sinGenero.find(aplica);
  }
  return ranges.find(aplica) ?? ranges[0];
}

/** Indexa las definiciones por código LOINC (solo las que tienen system LOINC). */
export function indexByLoinc(defs: BiomarkerDefinition[]): Map<string, BiomarkerDefinition> {
  const map = new Map<string, BiomarkerDefinition>();
  for (const def of defs) {
    if (def.code && def.system === LOINC_SYSTEM) {
      map.set(def.code, def);
    }
  }
  return map;
}

/** Indexa las definiciones por slug de biomarcador. */
export function indexByBiomarcador(defs: BiomarkerDefinition[]): Map<string, BiomarkerDefinition> {
  const map = new Map<string, BiomarkerDefinition>();
  for (const def of defs) {
    if (def.biomarcadorId) {
      map.set(def.biomarcadorId, def);
    }
  }
  return map;
}

/**
 * Trae las ObservationDefinitions de biomarcadores del servidor y las normaliza.
 *
 * El filtrado por sistema de identifier se hace en el CLIENTE, no en la query:
 * `ObservationDefinition` no expone `identifier` como search param estándar en
 * FHIR R4, y la forma de token `system|` (valor vacío) no es portable —Medplum
 * no la matchea contra identifiers de valor no vacío, así que devolvía 0
 * definiciones y el panel quedaba "sin definiciones cargadas". Traer todas y
 * filtrar acá es robusto y conserva el objetivo de excluir ODs ajenas de otros
 * equipos. _count alto cubre el panel (50 defs) en una sola página.
 */
export async function getBiomarkerDefinitions(medplum: MedplumClient): Promise<BiomarkerDefinition[]> {
  const ods = await medplum.searchResources('ObservationDefinition', { _count: '1000' });
  return ods
    .filter((od) => od.identifier?.some((i) => i.system === BIOMARCADOR_IDENTIFIER_SYSTEM))
    .map(parseObservationDefinition);
}

// ───────────────────────────────────────────────────────────────────────────
// Clasificación de un valor contra los rangos de su biomarcador, agnóstica a la
// dirección: usa los límites low/high de cada rango, así sirve igual para
// marcadores "más bajo mejor" (ApoB), "más alto mejor" (HDL) o con doble cola
// (ácido úrico, potasio).
// ───────────────────────────────────────────────────────────────────────────

/** Estado de un valor respecto de sus rangos. */
export type BiomarkerStatus = 'optimal' | 'normal' | 'high' | 'low' | 'unknown';

export interface BiomarkerStatusInfo {
  status: BiomarkerStatus;
  /** Etiqueta para mostrar, en español. */
  label: string;
  /** Color de la paleta de Mantine. */
  color: string;
}

const STATUS_INFO: Record<BiomarkerStatus, BiomarkerStatusInfo> = {
  optimal: { status: 'optimal', label: 'Óptimo', color: 'green' },
  normal: { status: 'normal', label: 'Normal', color: 'yellow' },
  high: { status: 'high', label: 'Alto', color: 'red' },
  low: { status: 'low', label: 'Bajo', color: 'red' },
  unknown: { status: 'unknown', label: '—', color: 'gray' },
};

function inRange(value: number, r: BiomarkerRange | undefined): boolean {
  if (!r) {
    return false;
  }
  return (r.low === undefined || value >= r.low) && (r.high === undefined || value <= r.high);
}

/**
 * Clasifica un valor: óptimo si cae en el rango funcional/óptimo; normal si cae
 * en el convencional pero no en el óptimo; alto/bajo si queda fuera del
 * convencional (o del óptimo si no hay convencional). Respeta el rango por
 * género y por edad cuando existe.
 */
export function classifyBiomarkerValue(
  def: BiomarkerDefinition,
  value: number | undefined,
  gender?: string,
  ageYears?: number
): BiomarkerStatusInfo {
  if (value === undefined || !Number.isFinite(value)) {
    return STATUS_INFO.unknown;
  }
  const optimal = rangeFor(def.optimal, gender, ageYears);
  const conventional = rangeFor(def.conventional, gender, ageYears);
  const aboveConventional = conventional?.high !== undefined && value > conventional.high;
  const belowConventional = conventional?.low !== undefined && value < conventional.low;
  // Dentro del óptimo es Óptimo, AUNQUE el óptimo se extienda más allá del
  // convencional a propósito (T3 Libre, DHEA-S, Testosterona: óptimo > tope
  // convencional). Excepción: un óptimo de UNA sola cola (Hb óptima ≥14, sin
  // tope) no debe tapar el tope convencional — si el valor lo supera y el óptimo
  // no acota esa cola, es alto/bajo.
  if (optimal && inRange(value, optimal)) {
    if (aboveConventional && optimal.high === undefined) {
      return STATUS_INFO.high;
    }
    if (belowConventional && optimal.low === undefined) {
      return STATUS_INFO.low;
    }
    return STATUS_INFO.optimal;
  }
  // Fuera del óptimo: el convencional es la referencia dura.
  if (aboveConventional) {
    return STATUS_INFO.high;
  }
  if (belowConventional) {
    return STATUS_INFO.low;
  }
  if (inRange(value, conventional)) {
    return STATUS_INFO.normal;
  }
  // Sin convencional: ubicar la dirección con el óptimo.
  if (optimal?.high !== undefined && value > optimal.high) {
    return STATUS_INFO.high;
  }
  if (optimal?.low !== undefined && value < optimal.low) {
    return STATUS_INFO.low;
  }
  return conventional ? STATUS_INFO.normal : STATUS_INFO.unknown;
}

/** Último valor observado de un biomarcador. */
export interface CodedValue {
  value: number;
  unit?: string;
  date?: string;
}

function observationDate(observation: Observation): string {
  return observation.effectiveDateTime ?? observation.issued ?? observation.meta?.lastUpdated ?? '';
}

/**
 * Indexa el último valor por código de Observation (cualquier coding). Procesa
 * de más nueva a más vieja; la primera por código gana. Descarta
 * entered-in-error y las que no tienen valueQuantity.
 */
export function latestValueByCode(observations: Observation[]): Map<string, CodedValue> {
  const newestFirst = [...observations].sort((a, b) => observationDate(b).localeCompare(observationDate(a)));
  const map = new Map<string, CodedValue>();
  for (const o of newestFirst) {
    if (o.status === 'entered-in-error' || o.valueQuantity?.value === undefined) {
      continue;
    }
    for (const coding of o.code?.coding ?? []) {
      if (coding.code && !map.has(coding.code)) {
        map.set(coding.code, {
          value: o.valueQuantity.value,
          unit: o.valueQuantity.unit,
          date: observationDate(o) || undefined,
        });
      }
    }
  }
  return map;
}

/**
 * Agrupa el historial completo por código de Observation, de más vieja a más
 * nueva (orden natural para una sparkline). Descarta entered-in-error y las que
 * no tienen valueQuantity.
 */
export function valuesByCodeHistory(observations: Observation[]): Map<string, CodedValue[]> {
  const oldestFirst = [...observations].sort((a, b) => observationDate(a).localeCompare(observationDate(b)));
  const map = new Map<string, CodedValue[]>();
  for (const o of oldestFirst) {
    if (o.status === 'entered-in-error' || o.valueQuantity?.value === undefined) {
      continue;
    }
    for (const coding of o.code?.coding ?? []) {
      if (!coding.code) {
        continue;
      }
      const entry: CodedValue = {
        value: o.valueQuantity.value,
        unit: o.valueQuantity.unit,
        date: observationDate(o) || undefined,
      };
      const list = map.get(coding.code) ?? [];
      list.push(entry);
      map.set(coding.code, list);
    }
  }
  return map;
}

// Orden de los paneles (foco cardiovascular primero, luego el resto BioHacking).
const PANEL_ORDER = [
  'metabolico',
  'lipidico',
  'inflamacion',
  'renal-hepatico',
  'hormonal',
  'micronutrientes',
  'longevidad',
  'microbiota',
  'toxicos',
  'autonomico',
];

export interface BiomarkerPanelGroup {
  panelCode: string;
  panelDisplay: string;
  defs: BiomarkerDefinition[];
}

/** Agrupa las definiciones por panel, en el orden de PANEL_ORDER (resto al final). */
export function groupByPanel(defs: BiomarkerDefinition[]): BiomarkerPanelGroup[] {
  const groups = new Map<string, BiomarkerDefinition[]>();
  for (const def of defs) {
    const code = def.panelCode ?? 'otros';
    const list = groups.get(code) ?? [];
    list.push(def);
    groups.set(code, list);
  }
  const rank = (code: string): number => {
    const i = PANEL_ORDER.indexOf(code);
    return i === -1 ? PANEL_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([panelCode, list]) => ({ panelCode, panelDisplay: list[0].panelDisplay ?? panelCode, defs: list }));
}

// Núcleo del "recetario" de órdenes de laboratorio de BioWellness (Fase 1).
//
// Objetivo del producto: que el médico solicite los 50 marcadores del programa
// en 1-2 clicks y que el paciente, desde el portal, avise que los necesita
// también en 1-2 clicks. Este módulo es la capa pura (sin UI ni I/O de Medplum)
// que:
//   1. Clasifica cada biomarcador por su "solicitabilidad" en un laboratorio de
//      cobertura privada (OSDE, Swiss Medical, OMINT, Medicus): análisis de
//      rutina (lab), estudio especializado (specialized), valor calculado a
//      partir de otros (derived) o medición por wearable (device).
//   2. Normaliza las BiomarkerDefinition (las 50 ObservationDefinition) a ítems
//      de orden.
//   3. Construye los recursos FHIR ServiceRequest de una orden: un
//      ServiceRequest por análisis, todos agrupados por un mismo
//      `requisition` (el "número de orden" del formulario de laboratorio),
//      NO un único ServiceRequest con 50 códigos.
//
// El flujo del médico crea ServiceRequest con intent 'order'; el del paciente,
// con intent 'proposal' (una solicitud que el médico luego aprueba emitiendo la
// orden). La emisión legal (firma electrónica, ReNaPDiS) es Fase 2 y no vive
// acá.
import type { CodeableConcept, ServiceRequest } from '@medplum/fhirtypes';
import { LOINC_SYSTEM } from '../ckm/observation-definitions';
import type { BiomarkerDefinition } from '../ckm/observation-definitions';

/** `system` del identificador de requisición (número de orden compartido). */
export const REQUISITION_SYSTEM = 'https://bio.medplum.com.ar/fhir/sid/orden-laboratorio';

/**
 * Máximo de operaciones de escritura por transacción que fragmentamos. El
 * servidor Medplum (@medplum/fhir-router) rechaza una transacción con MÁS de 50
 * operaciones `update` (PUT) —"Transaction contains more update operations than
 * allowed"—; los `create` (POST) no cuentan para ese límite. Fragmentamos por
 * debajo de 50 para dejar margen. Una solicitud del paciente con el panel
 * completo (~50 análisis) al aprobarse son 50 PUT y hay que partirlos.
 */
export const MAX_WRITES_PER_TX = 40;

/** Parte una lista en tandas de a lo sumo `size` elementos. */
export function chunk<T>(items: T[], size: number = MAX_WRITES_PER_TX): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Coberturas privadas ABC1 objetivo de BioWellness (San Isidro). No se incluyen
 * obras sociales ni PAMI por ahora. "Particular" para pacientes sin cobertura.
 * Es un dato informativo de la orden (viaja como nota); la autorización real
 * frente a la prepaga es un tema de Fase 2.
 */
export const COBERTURAS_PRIVADAS = ['OSDE', 'Swiss Medical', 'OMINT', 'Medicus', 'Particular'] as const;

/**
 * Categoría FHIR de un ServiceRequest de laboratorio (SNOMED CT
 * "Laboratory procedure"). Es la categoría que esperan los sistemas de
 * laboratorio y US Core para clasificar la orden.
 */
export const LABORATORY_CATEGORY: CodeableConcept = {
  coding: [{ system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' }],
  text: 'Laboratorio',
};

/**
 * Solicitabilidad de un marcador en el circuito de laboratorio:
 * - `lab`: análisis de rutina, con código LOINC, cubierto por prepagas ABC1.
 * - `specialized`: estudio de laboratorio especializado (metilación de ADN,
 *   telómeros, perfil de ácidos grasos, etc.); se puede pedir pero la cobertura
 *   privada por lo general NO lo reintegra.
 * - `derived`: valor calculado a partir de otros marcadores (HOMA-IR de
 *   glucosa+insulina, eGFR de creatinina); no se pide por separado, viene con su
 *   fuente.
 * - `component`: analito que viene dentro de un panel (los 24 del hemograma).
 *   Es un valor MEDIDO, no calculado, pero tampoco se pide suelto. Sin esta
 *   categoría hay que elegir entre dejarlo pedible o llamarlo "calculado", y
 *   ninguna de las dos es cierta.
 * - `device`: se mide con un wearable/dispositivo (HRV), no es un análisis.
 */
export type LabOrderability = 'lab' | 'specialized' | 'derived' | 'component' | 'device';

/**
 * Para los derivados que el médico puede llegar a elegir: qué hay que pedir EN
 * SU LUGAR.
 *
 * Esta tabla ya NO decide si un marcador es derivado — eso lo dice el catálogo
 * con la extensión `no-solicitable`. Lo que queda acá es lo único que el
 * catálogo no sabe expresar: sus fuentes. `formula-derivado` trae la fórmula en
 * prosa ("glucosa × insulina / 405"), que sirve para mostrarle al médico pero
 * no para armar una orden.
 *
 * Las fuentes se referencian por **código LOINC**, no por slug: el catálogo
 * mezcla convenciones de identificador, así que el LOINC es la clave estable.
 * `resolveDerivedSources` resuelve contra el identifier O el código.
 */
const DERIVED_SOURCES: Record<string, string[]> = {
  'homa-ir': ['1558-6', '20448-7'], // glucosa en ayunas + insulina basal
  'egfr-tfg-estimada': ['2160-0'], // creatinina sérica
};

/**
 * Marcadores que se miden con dispositivo, no en laboratorio.
 *
 * **No sale del catálogo a propósito**: el HRV no tiene la extensión
 * `no-solicitable`, así que si esta clasificación dependiera solo del catálogo,
 * el HRV volvería a ser solicitable. Se mantiene hasta que el catálogo lo
 * marque.
 */
const DEVICE_IDS = new Set(['hrv-variabilidad-frecuencia-cardiaca']);

/**
 * Clasifica un marcador por solicitabilidad.
 *
 * **La fuente de verdad es el catálogo**, no una lista de ids acá. La extensión
 * `no-solicitable` marca todo lo que no se pide suelto; la presencia de
 * `formula-derivado` distingue un cálculo de un componente de panel. Antes esto
 * eran dos ids hardcodeados y el catálogo marcaba 31: el dashboard dejaba emitir
 * órdenes pidiendo "Colesterol NO-HDL" o "Basófilos", que ningún laboratorio
 * puede procesar sueltos.
 */
export function orderabilityFor(def: BiomarkerDefinition): LabOrderability {
  const id = def.biomarcadorId ?? '';
  // El dispositivo primero: un wearable mal etiquetado como "calculado" manda
  // al médico a buscar una fuente que no existe.
  if (DEVICE_IDS.has(id)) {
    return 'device';
  }
  if (def.noSolicitable) {
    return def.formulaDerivado ? 'derived' : 'component';
  }
  if (def.system !== LOINC_SYSTEM || !def.code) {
    return 'specialized';
  }
  return 'lab';
}

export interface OrderabilityInfo {
  /** Etiqueta para mostrar, en español. */
  label: string;
  /** Color de la paleta de Mantine. */
  color: string;
  /** true si el marcador puede formar parte de una orden de laboratorio. */
  orderable: boolean;
  /** Aclaración para el médico (ej. cobertura, cómo se obtiene). */
  note?: string;
}

export const ORDERABILITY_INFO: Record<LabOrderability, OrderabilityInfo> = {
  lab: { label: 'Laboratorio', color: 'teal', orderable: true },
  specialized: {
    label: 'Especializado',
    color: 'grape',
    orderable: true,
    note: 'Laboratorio especializado; la cobertura privada por lo general no lo reintegra.',
  },
  derived: {
    label: 'Calculado',
    color: 'gray',
    orderable: false,
    note: 'Se calcula a partir de otros marcadores; se pide su fuente.',
  },
  component: {
    label: 'Viene en el panel',
    color: 'gray',
    orderable: false,
    note: 'Es un valor medido, pero no se pide suelto: llega con el panel que lo incluye.',
  },
  device: {
    label: 'Wearable',
    color: 'blue',
    orderable: false,
    note: 'Se mide con un dispositivo, no es un análisis de laboratorio.',
  },
};

/** Un marcador normalizado como ítem solicitable en una orden. */
export interface LabOrderItem {
  biomarcadorId?: string;
  label: string;
  code?: string;
  system?: string;
  panelCode?: string;
  panelDisplay?: string;
  orderability: LabOrderability;
  /** true si se puede incluir en una orden (lab o especializado con código). */
  orderable: boolean;
  /** Para los derivados: ids de los marcadores fuente que sí se piden. */
  derivedFrom?: string[];
}

/** Normaliza una BiomarkerDefinition a un ítem de orden. */
export function toLabOrderItem(def: BiomarkerDefinition): LabOrderItem {
  const orderability = orderabilityFor(def);
  return {
    biomarcadorId: def.biomarcadorId,
    label: def.label,
    code: def.code,
    system: def.system,
    panelCode: def.panelCode,
    panelDisplay: def.panelDisplay,
    orderability,
    orderable: ORDERABILITY_INFO[orderability].orderable,
    derivedFrom: def.biomarcadorId ? DERIVED_SOURCES[def.biomarcadorId] : undefined,
  };
}

/** Normaliza las 50 definiciones a ítems de orden. */
export function toLabOrderItems(defs: BiomarkerDefinition[]): LabOrderItem[] {
  return defs.map(toLabOrderItem);
}

/**
 * Dado un conjunto de ids seleccionados, agrega los ids fuente que hagan falta:
 * si el médico elige un derivado (eGFR), se asegura de que su fuente (creatinina)
 * quede en la orden, porque el derivado no se pide por sí mismo. Devuelve el
 * conjunto expandido (sin duplicados, preservando el orden de entrada primero).
 */
export function resolveDerivedSources(selectedIds: string[], catalog: LabOrderItem[]): string[] {
  const byId = new Map(catalog.map((i) => [i.biomarcadorId ?? '', i]));
  // Índice auxiliar por código LOINC: las fuentes de los derivados se declaran
  // por código (clave estable), pero la selección viaja por identifier. Sin
  // este segundo índice, la fuente no se encontraba y el análisis quedaba
  // FUERA de la orden en silencio.
  const byCode = new Map(catalog.filter((i) => i.code).map((i) => [i.code as string, i]));

  const result = new Set(selectedIds);
  for (const id of selectedIds) {
    for (const source of byId.get(id)?.derivedFrom ?? []) {
      // La fuente puede venir como código o como identifier: se agrega con el
      // identifier real del catálogo, que es la clave con la que se selecciona.
      const item = byCode.get(source) ?? byId.get(source);
      if (item) {
        result.add(item.biomarcadorId ?? source);
      }
    }
  }
  return [...result];
}

export interface LabOrderParams {
  /** Referencia al paciente sujeto de la orden. */
  subject: ServiceRequest['subject'];
  /**
   * Quién solicita: el Practitioner (flujo médico → intent 'order') o el propio
   * Patient (flujo del portal → intent 'proposal').
   */
  requester?: ServiceRequest['requester'];
  /** Ítems a incluir; se descartan los no solicitables (derivados/dispositivo). */
  items: LabOrderItem[];
  /** Identificador de requisición compartido por todos los ServiceRequest. */
  requisitionId: string;
  /** Fecha de autoría en ISO (se pasa desde afuera; el core es puro). */
  authoredOn: string;
  /** 'order' (médico) o 'proposal' (paciente). Por defecto 'order'. */
  intent?: 'order' | 'proposal';
  /** Nota libre (ej. cobertura "OSDE 210", indicación de ayuno). */
  note?: string;
}

function itemCode(item: LabOrderItem): CodeableConcept {
  const coding = item.code && item.system ? [{ system: item.system, code: item.code, display: item.label }] : undefined;
  return { ...(coding ? { coding } : {}), text: item.label };
}

/**
 * Construye la orden de laboratorio como una lista de ServiceRequest: uno por
 * análisis solicitable, todos con el mismo `requisition`. Los ítems no
 * solicitables (derivados, dispositivo) se omiten silenciosamente —el llamador
 * debería haber corrido resolveDerivedSources para traer sus fuentes—.
 *
 * Un proposal (paciente) queda en status 'draft' (todavía no es una orden
 * emitida); una order (médico) en status 'active'.
 */
export function buildLabOrder(params: LabOrderParams): ServiceRequest[] {
  const intent = params.intent ?? 'order';
  const status = intent === 'proposal' ? 'draft' : 'active';
  const requisition = { system: REQUISITION_SYSTEM, value: params.requisitionId };

  return params.items
    .filter((item) => item.orderable)
    .map((item) => ({
      resourceType: 'ServiceRequest' as const,
      status,
      intent,
      priority: 'routine' as const,
      category: [LABORATORY_CATEGORY],
      code: itemCode(item),
      subject: params.subject,
      authoredOn: params.authoredOn,
      requisition,
      ...(params.requester ? { requester: params.requester } : {}),
      ...(params.note ? { note: [{ text: params.note }] } : {}),
    }));
}

/**
 * Aprueba una solicitud del paciente: transforma cada ServiceRequest que venga
 * como propuesta ('proposal'/'draft') en una orden médica emitida
 * ('order'/'active'), sellada por el profesional (requester). Los que no sean
 * propuestas se devuelven intactos. Conserva la requisición (misma agrupación) y
 * el authoredOn original (cuándo lo pidió el paciente); deja constancia de la
 * aprobación en una nota. El badge del dashboard pasa de "Solicitud del paciente"
 * a "Orden médica" automáticamente al cambiar el intent.
 */
export function approveProposals(params: {
  proposals: ServiceRequest[];
  requester: ServiceRequest['requester'];
  approvalNote?: string;
}): ServiceRequest[] {
  return params.proposals.map((sr) => {
    if (sr.intent !== 'proposal') {
      return sr;
    }
    const note = params.approvalNote ? [...(sr.note ?? []), { text: params.approvalNote }] : sr.note;
    return {
      ...sr,
      status: 'active' as const,
      intent: 'order' as const,
      requester: params.requester,
      ...(note ? { note } : {}),
    };
  });
}

/** Agrupa ServiceRequest por su requisición (para mostrar una orden como unidad). */
export function groupByRequisition(requests: ServiceRequest[]): Map<string, ServiceRequest[]> {
  const map = new Map<string, ServiceRequest[]>();
  for (const req of requests) {
    const key = req.requisition?.value ?? req.id ?? '';
    const list = map.get(key) ?? [];
    list.push(req);
    map.set(key, list);
  }
  return map;
}

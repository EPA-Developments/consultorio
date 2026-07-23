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
 * - `device`: se mide con un wearable/dispositivo (HRV), no es un análisis.
 */
export type LabOrderability = 'lab' | 'specialized' | 'derived' | 'device';

/** Marcadores que son un cálculo derivado de otros (y sus fuentes a pedir). */
const DERIVED_SOURCES: Record<string, string[]> = {
  'homa-ir': ['glucosa-en-ayunas', 'insulina-en-ayunas'],
  'egfr-tfg-estimada': ['creatinina'],
};

/** Marcadores que se miden con dispositivo, no en laboratorio. */
const DEVICE_IDS = new Set(['hrv-variabilidad-frecuencia-cardiaca']);

/**
 * Clasifica un marcador por solicitabilidad. Un derivado se conoce por su id;
 * un marcador de dispositivo también. El resto: si no tiene código LOINC es un
 * estudio especializado (código local, sin nomenclador de rutina); si tiene
 * LOINC es laboratorio de rutina.
 */
export function orderabilityFor(def: BiomarkerDefinition): LabOrderability {
  const id = def.biomarcadorId ?? '';
  if (id in DERIVED_SOURCES) {
    return 'derived';
  }
  if (DEVICE_IDS.has(id)) {
    return 'device';
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
  const result = new Set(selectedIds);
  for (const id of selectedIds) {
    const item = byId.get(id);
    for (const source of item?.derivedFrom ?? []) {
      result.add(source);
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

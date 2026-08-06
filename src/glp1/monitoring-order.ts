// Puente entre el calendario de monitoreo GLP-1 y el recetario.
//
// El calendario nombra los estudios por slug del catálogo. El recetario trabaja
// con LabOrderItem y no todos los marcadores se piden igual: los derivados
// (HOMA-IR, eGFR) no se solicitan por sí mismos sino a través de sus fuentes.
// Traducir de un lado al otro sin perder nada es todo el trabajo de este
// módulo.
//
// Devuelve además qué quedó afuera y por qué, para que la pantalla pueda
// decirlo. Un estudio que desaparece en silencio del pedido es exactamente el
// tipo de error que no se detecta hasta que falta el resultado.
import type { LabOrderItem } from '../laborders/lab-order';
import { resolveDerivedSources } from '../laborders/lab-order';

export interface MonitoringOrderPlan {
  /** Ítems que van a la orden, ya expandidos y filtrados a los solicitables. */
  items: LabOrderItem[];
  /**
   * Derivados que se pidieron y se reemplazaron por sus fuentes (HOMA-IR se
   * pide como glucosa + insulina). No es una pérdida: es cómo se solicitan.
   */
  replacedDerived: string[];
  /** Slugs del calendario que no existen en el catálogo. No debería haber. */
  unknown: string[];
  /** Slugs que existen pero no se pueden solicitar (ej. medidos con dispositivo). */
  notOrderable: string[];
}

/**
 * Traduce los slugs de una visita del calendario a ítems de orden.
 *
 * Los derivados se expanden a sus fuentes ANTES de filtrar, porque si no
 * `buildLabOrder` los descarta y el análisis se pierde sin aviso.
 */
export function planOrderFor(labs: string[], catalog: LabOrderItem[]): MonitoringOrderPlan {
  const byId = new Map(catalog.map((i) => [i.biomarcadorId ?? '', i]));

  const unknown = labs.filter((s) => !byId.has(s));
  const conocidos = labs.filter((s) => byId.has(s));

  const expandidos = resolveDerivedSources(conocidos, catalog);

  const items: LabOrderItem[] = [];
  const notOrderable: string[] = [];
  for (const id of expandidos) {
    const item = byId.get(id);
    if (!item) {
      continue;
    }
    if (item.orderable) {
      items.push(item);
    } else if (item.orderability !== 'derived') {
      // Los derivados no cuentan como pérdida: ya se agregaron sus fuentes.
      notOrderable.push(id);
    }
  }

  const replacedDerived = conocidos.filter((s) => byId.get(s)?.orderability === 'derived');

  return { items, replacedDerived, unknown, notOrderable };
}

/** Nota que acompaña la orden, para que se entienda de dónde salió el pedido. */
export function monitoringOrderNote(visitLabel: string, molecule: string, cobertura: string): string {
  return `Cobertura: ${cobertura} · Control de tratamiento con ${molecule} (${visitLabel}).`;
}

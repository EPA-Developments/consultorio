// La receta de medicamentos: módulo puro.
//
// Espeja el diseño del recetario de laboratorio (lab-order.ts): acá se
// construyen y validan los MedicationRequest, sin red y sin UI. La escritura
// vive en receta-create.ts, con el mismo gate de emisión que las órdenes.
//
// LO QUE LA LEY PIDE Y EL MÓDULO EXIGE:
//
// - DCI OBLIGATORIA (Ley 25.649): la prescripción es por nombre genérico.
//   El campo se llama `dci` a propósito, para que nadie escriba una marca sin
//   notar que está en el lugar equivocado. La marca puede acompañar como
//   sugerencia, nunca reemplazar.
// - POSOLOGÍA OBLIGATORIA: una receta sin posología no es una indicación
//   médica, es una autorización de compra.
// - CANTIDAD OBLIGATORIA y entera: el farmacéutico dispensa unidades.
// - DIAGNÓSTICO OBLIGATORIO (Ley 27.553 / receta electrónica): viaja en
//   reasonCode.
//
// Cada ítem es UN MedicationRequest; los de una misma receta comparten el
// groupIdentifier, igual que la requisición de laboratorio.
import type { CodeableConcept, MedicationRequest, Reference } from '@medplum/fhirtypes';

/** system del número de receta (groupIdentifier). */
export const RECETA_SYSTEM = 'https://bio.medplum.com.ar/fhir/sid/receta';

export interface ItemReceta {
  /** Denominación Común Internacional. Obligatoria (Ley 25.649). */
  dci: string;
  /** Forma y concentración: "comprimidos 500 mg". */
  presentacion?: string;
  /** Unidades a dispensar (envases o unidades, según presentación). */
  cantidad: number;
  /** Indicación de uso: "1 comprimido cada 12 h con las comidas, 30 días". */
  posologia: string;
  /** Sugerencia de marca. NUNCA reemplaza a la DCI; la acompaña. */
  marcaSugerida?: string;
}

export interface RecetaParams {
  subject: Reference;
  requester?: Reference;
  items: ItemReceta[];
  /** Diagnóstico que motiva la prescripción. Obligatorio. */
  diagnostico: string;
  recetaId: string;
  authoredOn: string;
  note?: string;
}

/**
 * Valida una receta antes de construirla. Devuelve los problemas encontrados,
 * en castellano y listados todos juntos: el médico corrige una vez, no una
 * vuelta por cada error.
 */
export function validarReceta(items: ItemReceta[], diagnostico: string): string[] {
  const problemas: string[] = [];
  if (items.length === 0) {
    problemas.push('La receta no tiene ningún medicamento.');
  }
  if (!diagnostico.trim()) {
    problemas.push('Falta el diagnóstico que motiva la prescripción.');
  }
  items.forEach((item, i) => {
    const pos = `Ítem ${i + 1}`;
    if (!item.dci.trim()) {
      problemas.push(`${pos}: falta la DCI (nombre genérico, Ley 25.649).`);
    }
    if (!item.posologia.trim()) {
      problemas.push(`${pos} (${item.dci || 'sin DCI'}): falta la posología.`);
    }
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      problemas.push(`${pos} (${item.dci || 'sin DCI'}): la cantidad debe ser un entero mayor a cero.`);
    }
  });
  return problemas;
}

function medicamentoConcept(item: ItemReceta): CodeableConcept {
  const texto = [item.dci.trim(), item.presentacion?.trim()].filter(Boolean).join(' — ');
  return { text: texto };
}

/** Construye los MedicationRequest de una receta ya validada. */
export function buildReceta(params: RecetaParams): MedicationRequest[] {
  return params.items.map((item): MedicationRequest => {
    const notas = [
      ...(item.marcaSugerida
        ? [{ text: `Marca sugerida: ${item.marcaSugerida} (puede sustituirse, Ley 25.649).` }]
        : []),
      ...(params.note ? [{ text: params.note }] : []),
    ];
    return {
      resourceType: 'MedicationRequest',
      status: 'active',
      intent: 'order',
      medicationCodeableConcept: medicamentoConcept(item),
      subject: params.subject as MedicationRequest['subject'],
      requester: params.requester as MedicationRequest['requester'],
      authoredOn: params.authoredOn,
      groupIdentifier: { system: RECETA_SYSTEM, value: params.recetaId },
      reasonCode: [{ text: params.diagnostico }],
      dosageInstruction: [{ text: item.posologia }],
      dispenseRequest: {
        quantity: { value: item.cantidad, unit: 'unidades' },
      },
      note: notas.length > 0 ? notas : undefined,
    };
  });
}

/** Agrupa MedicationRequests por número de receta, más recientes primero. */
export function groupByReceta(requests: MedicationRequest[]): Map<string, MedicationRequest[]> {
  const groups = new Map<string, MedicationRequest[]>();
  for (const r of requests) {
    const id = r.groupIdentifier?.value ?? '(sin receta)';
    const list = groups.get(id) ?? [];
    list.push(r);
    groups.set(id, list);
  }
  return groups;
}

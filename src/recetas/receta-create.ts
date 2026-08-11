// Emisión de una receta de medicamentos contra el servidor.
//
// El mismo diseño que lab-order-create: módulo puro aparte (receta.ts), un
// solo camino de escritura, y el gate de emisión COMPARTIDO con las órdenes de
// laboratorio (emission-gate.ts). Prescribir un medicamento y pedir un
// análisis son el mismo acto legal con distinto objeto: profesional
// matriculado y habilitado firma una indicación. La validación es una sola.
import type { MedplumClient } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { Bundle, MedicationRequest, Patient } from '@medplum/fhirtypes';
import {
  constanciaRefeps,
  EXT_REFEPS_VERIFICACION,
  validarEmisor,
  valorVerificacion,
} from '../laborders/emission-gate';
import { EmissionBlockedError } from '../laborders/practitioner-validation';
import type { RefepsCheckResult } from '../laborders/refeps-client';
import { buildReceta, validarReceta } from './receta';
import type { ItemReceta } from './receta';
import { buildRecetaProvenance, conSelloReceta, sellarReceta } from './receta-emision';

/** Genera un número de receta legible. */
export function newRecetaId(): string {
  return 'REC-' + crypto.randomUUID().slice(0, 8).toUpperCase();
}

export interface CreateRecetaParams {
  patient: Patient;
  items: ItemReceta[];
  diagnostico: string;
  /** conceptId SNOMED del diagnóstico, si se eligió del índice. */
  diagnosticoSnomedId?: string;
  note?: string;
  /** Se puede fijar para que sea reproducible; si no, se genera. */
  recetaId?: string;
}

export interface CreatedReceta {
  recetaId: string;
  requests: MedicationRequest[];
  refeps: RefepsCheckResult;
}

/**
 * Emite la receta: valida el contenido, valida al emisor (local + REFEPS) y
 * escribe todos los MedicationRequest en una transacción.
 */
export async function createReceta(medplum: MedplumClient, params: CreateRecetaParams): Promise<CreatedReceta> {
  // Primero el contenido: no tiene sentido consultar el registro federal para
  // una receta a la que le falta la posología.
  const problemas = validarReceta(params.items, params.diagnostico);
  if (problemas.length > 0) {
    throw new EmissionBlockedError(problemas);
  }

  const { practitioner, refeps } = await validarEmisor(medplum);

  const recetaId = params.recetaId ?? newRecetaId();
  const authoredOn = new Date().toISOString();
  const constancia = constanciaRefeps(refeps, authoredOn);

  const requests = buildReceta({
    subject: createReference(params.patient),
    requester: createReference(practitioner),
    items: params.items,
    diagnostico: params.diagnostico,
    diagnosticoSnomedId: params.diagnosticoSnomedId,
    recetaId,
    authoredOn,
    note: [params.note, constancia].filter(Boolean).join(' · '),
  }).map((r) => ({
    ...r,
    extension: [...(r.extension ?? []), { url: EXT_REFEPS_VERIFICACION, valueString: valorVerificacion(refeps) }],
  }));

  // Sello de integridad + Provenance de firma, en la MISMA transacción que
  // crea la receta: emitir ES el acto firmado del profesional. Los targets
  // van como urn:uuid y el servidor los reescribe a las referencias reales.
  const seal = await sellarReceta(requests);
  const selladas = requests.map((r) => ({ ...r, identifier: conSelloReceta(r, seal) }));
  const urns = selladas.map(() => `urn:uuid:${crypto.randomUUID()}`);
  const provenance = buildRecetaProvenance({ targets: urns, practitioner, when: authoredOn, seal });

  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      ...selladas.map((resource, i) => ({
        fullUrl: urns[i],
        request: { method: 'POST' as const, url: 'MedicationRequest' },
        resource,
      })),
      { request: { method: 'POST' as const, url: 'Provenance' }, resource: provenance },
    ],
  };
  await medplum.executeBatch(bundle);

  return { recetaId, requests: selladas, refeps };
}

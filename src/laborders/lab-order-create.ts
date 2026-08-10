// Emisión de una orden de laboratorio contra el servidor.
//
// Vive aparte de lab-order.ts (que es puro) porque acá sí se escribe. Lo usan
// el recetario y el protocolo GLP-1: un solo camino de escritura, para que la
// orden que sale del calendario de monitoreo sea idéntica a la que sale del
// panel de órdenes.
//
// La validación del profesional (local + REFEPS) vive en emission-gate.ts,
// compartida con la receta de medicamentos: es el mismo acto legal con
// distinto objeto, y dos validaciones paralelas divergirían.
import type { MedplumClient } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { Bundle, Patient, ServiceRequest } from '@medplum/fhirtypes';
import { constanciaRefeps, EXT_REFEPS_VERIFICACION, validarEmisor, valorVerificacion } from './emission-gate';
import type { LabOrderItem } from './lab-order';
import { buildLabOrder } from './lab-order';
import type { RefepsCheckResult } from './refeps-client';

export { EXT_REFEPS_VERIFICACION };

/** Genera un número de orden legible a partir de un UUID del navegador. */
export function newRequisitionId(): string {
  return 'ORD-' + crypto.randomUUID().slice(0, 8).toUpperCase();
}

export interface CreateLabOrderParams {
  patient: Patient;
  items: LabOrderItem[];
  /** 'order' (médico) o 'proposal' (paciente). Por defecto 'order'. */
  intent?: 'order' | 'proposal';
  note?: string;
  /** Se puede fijar para que sea reproducible; si no, se genera. */
  requisitionId?: string;
}

export interface CreatedLabOrder {
  requisitionId: string;
  requests: ServiceRequest[];
  /**
   * Resultado de la consulta a REFEPS, para que la pantalla pueda decir si la
   * orden salió verificada o sin verificar. Ausente en las propuestas.
   */
  refeps?: RefepsCheckResult;
}

/**
 * Emite la orden. El solicitante sale del perfil activo si es un Practitioner;
 * si no (por ejemplo el portal del paciente), la orden queda sin requester y el
 * intent debería ser 'proposal'.
 */
export async function createLabOrder(medplum: MedplumClient, params: CreateLabOrderParams): Promise<CreatedLabOrder> {
  const esOrden = (params.intent ?? 'order') === 'order';

  // Las propuestas del paciente no pasan por el gate: no las firma un
  // profesional. Todo lo demás, sí.
  const emisor = esOrden ? await validarEmisor(medplum) : undefined;

  const profile = medplum.getProfile();
  const practitioner = emisor?.practitioner ?? (profile?.resourceType === 'Practitioner' ? profile : undefined);
  const requester = practitioner ? createReference(practitioner) : undefined;
  const requisitionId = params.requisitionId ?? newRequisitionId();
  const authoredOn = new Date().toISOString();

  // La constancia viaja en la nota (se lee y se imprime) y en una extensión
  // (se consulta por máquina). En las dos, para que ni el laboratorio ni un
  // auditor tengan que adivinar si la verificación ocurrió.
  const constancia = emisor ? constanciaRefeps(emisor.refeps, authoredOn) : undefined;
  const note = [params.note, constancia].filter(Boolean).join(' · ') || undefined;

  const requests = buildLabOrder({
    subject: createReference(params.patient),
    requester,
    items: params.items,
    requisitionId,
    authoredOn,
    intent: params.intent ?? 'order',
    note,
  }).map((r) =>
    emisor
      ? {
          ...r,
          extension: [
            ...(r.extension ?? []),
            { url: EXT_REFEPS_VERIFICACION, valueString: valorVerificacion(emisor.refeps) },
          ],
        }
      : r
  );

  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: requests.map((resource) => ({ request: { method: 'POST', url: 'ServiceRequest' }, resource })),
  };
  await medplum.executeBatch(bundle);

  return { requisitionId, requests, refeps: emisor?.refeps };
}

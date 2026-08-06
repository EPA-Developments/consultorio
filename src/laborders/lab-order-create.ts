// Emisión de una orden de laboratorio contra el servidor.
//
// Vive aparte de lab-order.ts (que es puro) porque acá sí se escribe. Lo usan
// el recetario y el protocolo GLP-1: un solo camino de escritura, para que la
// orden que sale del calendario de monitoreo sea idéntica a la que sale del
// panel de órdenes.
import type { MedplumClient } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { Bundle, Patient, ServiceRequest } from '@medplum/fhirtypes';
import type { LabOrderItem } from './lab-order';
import { buildLabOrder } from './lab-order';
import { checkPractitionerForEmission, EmissionBlockedError } from './practitioner-validation';

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
}

/**
 * Emite la orden. El solicitante sale del perfil activo si es un Practitioner;
 * si no (por ejemplo el portal del paciente), la orden queda sin requester y el
 * intent debería ser 'proposal'.
 */
export async function createLabOrder(
  medplum: MedplumClient,
  params: CreateLabOrderParams
): Promise<CreatedLabOrder> {
  const profile = medplum.getProfile();
  const practitioner = profile?.resourceType === 'Practitioner' ? profile : undefined;

  // Una orden médica lleva la matrícula de quien la firma. Hasta ahora se
  // imprimía "si estaba", así que una orden sin matrícula salía igual y el
  // problema recién aparecía en el laboratorio. Las propuestas del paciente no
  // pasan por acá: no las firma un profesional.
  if ((params.intent ?? 'order') === 'order') {
    const check = checkPractitionerForEmission(practitioner);
    if (!check.canEmit) {
      throw new EmissionBlockedError(check.problems);
    }
  }

  const requester = practitioner ? createReference(practitioner) : undefined;
  const requisitionId = params.requisitionId ?? newRequisitionId();

  const requests = buildLabOrder({
    subject: createReference(params.patient),
    requester,
    items: params.items,
    requisitionId,
    authoredOn: new Date().toISOString(),
    intent: params.intent ?? 'order',
    note: params.note,
  });

  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: requests.map((resource) => ({ request: { method: 'POST', url: 'ServiceRequest' }, resource })),
  };
  await medplum.executeBatch(bundle);

  return { requisitionId, requests };
}

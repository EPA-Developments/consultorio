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
import { buildEmissionProvenance, sealOrder, withSeal } from './lab-order-emission';
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
  //
  // Va en su PROPIA nota, no pegada a la del pedido. Cuando se concatenaban con
  // ' · ', coverageFromNote leía hasta el fin de línea y la orden impresa salía
  // con "Cobertura: Swiss Medical · Matrícula sin verificar contra REFEPS…":
  // la constancia disfrazada de plan de cobertura, en un documento clínico.
  const constancia = emisor ? constanciaRefeps(emisor.refeps, authoredOn) : undefined;
  const notas = [params.note, constancia].filter((t): t is string => Boolean(t));

  const requests = buildLabOrder({
    subject: createReference(params.patient),
    requester,
    items: params.items,
    requisitionId,
    authoredOn,
    intent: params.intent ?? 'order',
    notas,
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

  // Sello de integridad + Provenance de firma, en la MISMA transacción que crea
  // la orden: emitir ES el acto firmado del profesional. Mismo diseño que
  // createReceta — el objeto cambia, el acto legal no.
  //
  // Las PROPUESTAS del paciente no se sellan ni se firman a propósito: no son
  // un acto firmado por un profesional, sino un pedido. Se sellan recién al
  // aprobarse, que es cuando alguien matriculado se hace responsable.
  if (!emisor) {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: requests.map((resource) => ({ request: { method: 'POST', url: 'ServiceRequest' }, resource })),
    };
    await medplum.executeBatch(bundle);
    return { requisitionId, requests, refeps: undefined };
  }

  const seal = await sealOrder(requests);
  const selladas = requests.map((r) => ({ ...r, identifier: withSeal(r, seal) }));
  // Los targets van como urn:uuid porque las órdenes todavía no existen: el
  // servidor los reescribe a las referencias reales al resolver la transacción.
  const urns = selladas.map(() => `urn:uuid:${crypto.randomUUID()}`);
  const provenance = buildEmissionProvenance({
    requests: selladas,
    targets: urns,
    practitioner: emisor.practitioner,
    when: authoredOn,
    seal,
  });

  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      ...selladas.map((resource, i) => ({
        fullUrl: urns[i],
        request: { method: 'POST' as const, url: 'ServiceRequest' },
        resource,
      })),
      { request: { method: 'POST' as const, url: 'Provenance' }, resource: provenance },
    ],
  };
  await medplum.executeBatch(bundle);

  return { requisitionId, requests: selladas, refeps: emisor.refeps };
}

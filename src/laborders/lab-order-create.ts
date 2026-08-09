// Emisión de una orden de laboratorio contra el servidor.
//
// Vive aparte de lab-order.ts (que es puro) porque acá sí se escribe. Lo usan
// el recetario y el protocolo GLP-1: un solo camino de escritura, para que la
// orden que sale del calendario de monitoreo sea idéntica a la que sale del
// panel de órdenes.
//
// DOS VALIDACIONES ANTES DE EMITIR, en orden:
//
// 1. LOCAL: matrícula cargada y con forma de matrícula. Sin red.
// 2. REFEPS: la matrícula existe y está habilitada en el registro federal
//    (requisito §5.2 del trámite ReNaPDiS). Va por el bot refeps-verify, que
//    es quien guarda el secreto del Bus.
//
// La política con REFEPS distingue tres resultados, y la distinción es la que
// protege al profesional:
// - verificado        -> emite, y la constancia viaja en la orden.
// - rechazo del registro (no figura, inactivo, matrícula no coincide / no
//   habilitada / vencida) -> BLOQUEA con el motivo. Acá REFEPS contestó.
// - unavailable (el Bus no contestó) -> EMITE IGUAL, dejando constancia de que
//   no se pudo verificar. Un 503 del Estado no convierte a un profesional
//   matriculado en uno que no lo está, y trasladarle esa caída sería frenar
//   atención real por un problema que no es suyo.
import type { MedplumClient } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { Bundle, Patient, ServiceRequest } from '@medplum/fhirtypes';
import type { LabOrderItem } from './lab-order';
import { buildLabOrder } from './lab-order';
import { checkPractitionerForEmission, EmissionBlockedError } from './practitioner-validation';
import { checkRefeps, isRejected } from './refeps-client';
import type { RefepsCheckResult } from './refeps-client';

/** Genera un número de orden legible a partir de un UUID del navegador. */
export function newRequisitionId(): string {
  return 'ORD-' + crypto.randomUUID().slice(0, 8).toUpperCase();
}

/**
 * Extensión con el resultado de la verificación REFEPS al momento de emitir.
 * valueString: 'verificado' o 'no-verificable'. Los rechazos no llegan acá:
 * bloquean antes de que exista la orden.
 */
export const EXT_REFEPS_VERIFICACION = 'https://biowellness.ar/fhir/StructureDefinition/refeps-verificacion';

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

/** La constancia humana que viaja en la nota de la orden (y se imprime). */
function constanciaRefeps(refeps: RefepsCheckResult, fecha: string): string {
  if (refeps.verification?.verdict === 'verificado') {
    return `Matrícula verificada en REFEPS (${fecha.slice(0, 10)})`;
  }
  return `Matrícula sin verificar contra REFEPS al emitir (registro sin respuesta)`;
}

/**
 * Emite la orden. El solicitante sale del perfil activo si es un Practitioner;
 * si no (por ejemplo el portal del paciente), la orden queda sin requester y el
 * intent debería ser 'proposal'.
 */
export async function createLabOrder(medplum: MedplumClient, params: CreateLabOrderParams): Promise<CreatedLabOrder> {
  const profile = medplum.getProfile();
  const practitioner = profile?.resourceType === 'Practitioner' ? profile : undefined;
  const esOrden = (params.intent ?? 'order') === 'order';

  let refeps: RefepsCheckResult | undefined;
  if (esOrden) {
    // 1. Local: una orden médica lleva la matrícula de quien la firma. Las
    // propuestas del paciente no pasan por acá: no las firma un profesional.
    const check = checkPractitionerForEmission(practitioner);
    if (!check.canEmit) {
      throw new EmissionBlockedError(check.problems);
    }

    // 2. REFEPS. checkRefeps no lanza: una caída del Bus vuelve como
    // `unavailable`, que NO es un rechazo y no bloquea.
    refeps = await checkRefeps(medplum, practitioner as NonNullable<typeof practitioner>);
    if (isRejected(refeps)) {
      throw new EmissionBlockedError([
        `REFEPS rechazó la emisión: ${refeps.verification?.message ?? refeps.verification?.verdict}`,
      ]);
    }
  }

  const requester = practitioner ? createReference(practitioner) : undefined;
  const requisitionId = params.requisitionId ?? newRequisitionId();
  const authoredOn = new Date().toISOString();

  // La constancia viaja en la nota (se lee y se imprime) y en una extensión
  // (se consulta por máquina). En las dos, para que ni el laboratorio ni un
  // auditor tengan que adivinar si la verificación ocurrió.
  const constancia = refeps ? constanciaRefeps(refeps, authoredOn) : undefined;
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
    refeps
      ? {
          ...r,
          extension: [
            ...(r.extension ?? []),
            {
              url: EXT_REFEPS_VERIFICACION,
              valueString: refeps.verification?.verdict === 'verificado' ? 'verificado' : 'no-verificable',
            },
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

  return { requisitionId, requests, refeps };
}

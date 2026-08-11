// Sello de integridad y firma de la RECETA — el mismo modelo que
// lab-order-emission, con el objeto cambiado: MedicationRequest en lugar de
// ServiceRequest. Prescribir y pedir un análisis son el mismo acto legal; el
// sellado también es uno solo.
//
// ⚠️ La regla de honestidad regulatoria de lab-order-emission aplica entera:
// el sello + Provenance vuelven la receta TRAZABLE y VERIFICABLE
// ('signed-internal'), pero NO legalmente emitida. 'legally-emitted' requiere
// la inscripción en el Registro de Recetarios Electrónicos y el CUIR asignado
// por el sistema nacional — nunca se declara sin eso.
import type { Identifier, MedicationRequest, Practitioner, Provenance, Signature } from '@medplum/fhirtypes';
import { CUIR_SYSTEM, sha256Hex, SIGNATURE_TYPE_AUTHOR } from '../laborders/lab-order-emission';
import type { EmissionStatus } from '../laborders/lab-order-emission';

/** `system` del sello de integridad de una receta (hash de su contenido). */
export const SELLO_RECETA_SYSTEM = 'https://bio.medplum.com.ar/fhir/sid/sello-receta';

/** Lee el sello de integridad de una receta. */
export function getSelloReceta(request: MedicationRequest): string | undefined {
  return request.identifier?.find((i) => i.system === SELLO_RECETA_SYSTEM)?.value;
}

/** Lee el CUIR de una receta, si el sistema nacional ya lo asignó. */
export function getCuirReceta(request: MedicationRequest): string | undefined {
  return request.identifier?.find((i) => i.system === CUIR_SYSTEM)?.value;
}

/**
 * Contenido jurídicamente relevante de la receta, canónico y determinista:
 * número de receta, paciente, prescriptor, fecha y los ítems (medicamento,
 * posología y cantidad, ordenados para que la misma receta selle igual
 * siempre). Lo que no puede cambiar sin invalidar la firma.
 */
export function canonicalRecetaContent(requests: MedicationRequest[]): string {
  const first = requests[0];
  if (!first) {
    return '';
  }
  const receta = first.groupIdentifier?.value ?? '';
  const subject = first.subject?.reference ?? '';
  const requester = first.requester?.reference ?? '';
  const authored = first.authoredOn ?? '';
  const items = requests
    .map((r) =>
      [
        r.medicationCodeableConcept?.text ?? '',
        r.dosageInstruction?.[0]?.text ?? '',
        String(r.dispenseRequest?.quantity?.value ?? ''),
      ].join('|')
    )
    .sort((a, b) => a.localeCompare(b))
    .join(';');
  return [receta, subject, requester, authored, items].join('\n');
}

/** Sello de integridad: SHA-256 del contenido canónico. */
export async function sellarReceta(requests: MedicationRequest[]): Promise<string> {
  return sha256Hex(canonicalRecetaContent(requests));
}

/**
 * Verifica que la receta no haya cambiado desde su firma: recalcula el sello y
 * lo compara con el guardado. false si no hay sello.
 */
export async function verificarSelloReceta(requests: MedicationRequest[]): Promise<boolean> {
  const guardado = requests.map(getSelloReceta).find(Boolean);
  if (!guardado) {
    return false;
  }
  return (await sellarReceta(requests)) === guardado;
}

/** Identifiers de la receta con el sello agregado (sin duplicarlo). */
export function conSelloReceta(request: MedicationRequest, seal: string): Identifier[] {
  const otros = (request.identifier ?? []).filter((i) => i.system !== SELLO_RECETA_SYSTEM);
  return [...otros, { system: SELLO_RECETA_SYSTEM, value: seal }];
}

/** Actividad del Provenance: la receta fue firmada por el profesional. */
const ACTIVIDAD_FIRMA = {
  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'CREATE', display: 'create' }],
  text: 'Firma y emisión de la receta de medicamentos',
};

/**
 * Provenance que deja registro inmutable de la firma de la receta: quién,
 * cuándo, sobre qué recursos y con qué sello. `targets` acepta URNs
 * (urn:uuid:…) para poder viajar en la misma transacción que crea los
 * MedicationRequest — el servidor los reescribe a referencias reales.
 */
export function buildRecetaProvenance(params: {
  targets: string[];
  practitioner: Practitioner;
  when: string;
  seal: string;
}): Provenance {
  const { practitioner, when, seal } = params;
  const n = practitioner.name?.[0];
  const who = {
    reference: `Practitioner/${practitioner.id}`,
    display: n ? [n.prefix?.join(' '), n.given?.join(' '), n.family].filter(Boolean).join(' ') : 'Profesional',
  };
  const signature: Signature = { type: SIGNATURE_TYPE_AUTHOR, when, who };
  return {
    resourceType: 'Provenance',
    target: params.targets.map((reference) => ({ reference })),
    recorded: when,
    activity: ACTIVIDAD_FIRMA,
    agent: [
      {
        type: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author' }],
        },
        who,
      },
    ],
    signature: [signature],
    extension: [{ url: SELLO_RECETA_SYSTEM, valueString: seal }],
  };
}

/**
 * Estado de emisión de una receta, derivado de sus datos, sin adivinar:
 * CUIR => emitida legalmente; sello + firma registrada => firmada; si no,
 * borrador. La impresión declara SOLO lo que puede probar.
 */
export function emissionStatusOfReceta(request: MedicationRequest, hasSignature: boolean): EmissionStatus {
  if (getCuirReceta(request)) {
    return 'legally-emitted';
  }
  if (hasSignature && getSelloReceta(request)) {
    return 'signed-internal';
  }
  return 'draft';
}

// El camino de vuelta: el PDF firmado en firmar.gob.ar entra a la historia
// clínica.
//
// Hasta acá el circuito terminaba en la carpeta de Descargas del profesional:
// la receta quedaba firmada en un archivo que el sistema no tenía. Eso deja sin
// sustento la conservación mínima de 3 años (Res. 2214/2025, RETENTION_YEARS) y
// deja al documento legal fuera del registro clínico.
//
// El PDF firmado se guarda como Binary + DocumentReference colgado de la
// receta, y la firma real —el PKCS#7 que emitió la AC del Estado— va al
// Provenance en Signature.data. Ese campo estaba modelado y vacío desde que se
// escribió lab-order-emission: era exactamente esto lo que esperaba.
//
// Nada de esto sube el estado a 'legally-emitted'. La firma del profesional
// acredita AUTORÍA; la emisión legal requiere la inscripción en el ReNaPDiS y
// el CUIR asignado por el Estado. Se sigue declarando solo lo que se puede
// probar.
import type { MedplumClient } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { Bundle, DocumentReference, MedicationRequest, Patient, Practitioner, Provenance } from '@medplum/fhirtypes';
import { CUIL_SYSTEMS, identifierIn } from '../ckm/argentina';
import { SIGNATURE_TYPE_AUTHOR } from '../laborders/lab-order-emission';
import type { VerificacionPdfFirmado } from '../pdf/signed-pdf';
import { parseSignedPdf, verificarPdfFirmado } from '../pdf/signed-pdf';
import { getSelloReceta } from './receta-emision';
import { RECETA_SYSTEM } from './receta';

/** LOINC del documento "prescripción de medicamentos". */
export const LOINC_RECETA_DOC = { system: 'http://loinc.org', code: '57833-6', display: 'Prescription for medication' };

/** Formato de la firma que devuelve la Plataforma de Firma Digital Remota. */
export const SIG_FORMAT_PKCS7 = 'application/pkcs7-signature';

/**
 * Convierte una fecha de PDF (`D:20260818222024-03'00'`) a ISO. Devuelve
 * undefined si no tiene la forma esperada: preferimos no registrar fecha antes
 * que registrar una inventada.
 */
export function fechaPdfAIso(fecha: string | undefined): string | undefined {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:([+-])(\d{2})'?(\d{2})'?|Z)?$/.exec(fecha ?? '');
  if (!m) {
    return undefined;
  }
  const [, a, mes, d, h, min, s, signo, zh, zm] = m;
  const offset = signo ? `${signo}${zh}:${zm}` : 'Z';
  const iso = `${a}-${mes}-${d}T${h}:${min}:${s}${offset}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export interface RecetaFirmadaParams {
  recetaId: string;
  requests: MedicationRequest[];
  patient: Patient;
  practitioner: Practitioner;
  /** URL del Binary ya subido (`Binary/<id>`). */
  binaryUrl: string;
  filename: string;
  /** PKCS#7 en base64, tal como salió del PDF firmado. */
  signatureData: string;
  /** Momento de firma en ISO, si el PDF lo declara. */
  firmadoEl?: string;
}

/**
 * DocumentReference + Provenance de la receta firmada, como transacción. Los
 * dos en la misma escritura: un documento firmado sin su registro de firma, o
 * al revés, es peor que ninguno de los dos.
 */
export function buildRecetaFirmadaBundle(params: RecetaFirmadaParams): Bundle {
  const { requests, practitioner, recetaId } = params;
  const when = params.firmadoEl ?? new Date().toISOString();
  const docUrn = `urn:uuid:${crypto.randomUUID()}`;

  const documento: DocumentReference = {
    resourceType: 'DocumentReference',
    status: 'current',
    docStatus: 'final',
    identifier: [{ system: RECETA_SYSTEM, value: recetaId }],
    type: { coding: [LOINC_RECETA_DOC], text: 'Receta médica firmada digitalmente' },
    subject: createReference(params.patient),
    date: when,
    author: [createReference(practitioner)],
    description: `Receta ${recetaId} firmada digitalmente (Firma Digital Argentina).`,
    content: [
      {
        attachment: {
          contentType: 'application/pdf',
          url: params.binaryUrl,
          title: params.filename,
          creation: when,
        },
      },
    ],
    context: { related: requests.filter((r) => r.id).map((r) => ({ reference: `MedicationRequest/${r.id}` })) },
  };

  const who = { reference: `Practitioner/${practitioner.id}`, display: nombreDe(practitioner) };
  const provenance: Provenance = {
    resourceType: 'Provenance',
    target: [
      ...requests.filter((r) => r.id).map((r) => ({ reference: `MedicationRequest/${r.id}` })),
      { reference: docUrn },
    ],
    recorded: when,
    activity: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'UPDATE', display: 'update' }],
      text: 'Firma digital de la receta (Firma Digital Argentina)',
    },
    agent: [
      {
        type: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author' }],
        },
        who,
      },
    ],
    signature: [
      {
        type: SIGNATURE_TYPE_AUTHOR,
        when,
        who,
        data: params.signatureData,
        sigFormat: SIG_FORMAT_PKCS7,
        targetFormat: 'application/pdf',
      },
    ],
  };

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      { fullUrl: docUrn, request: { method: 'POST', url: 'DocumentReference' }, resource: documento },
      { request: { method: 'POST', url: 'Provenance' }, resource: provenance },
    ],
  };
}

export class RecetaFirmadaRechazadaError extends Error {
  constructor(readonly verificacion: VerificacionPdfFirmado) {
    super(verificacion.problemas.join(' '));
    this.name = 'RecetaFirmadaRechazadaError';
  }
}

export interface RecetaFirmadaGuardada {
  verificacion: VerificacionPdfFirmado;
  binaryUrl: string;
}

/**
 * Verifica el PDF firmado contra la receta emitida y, solo si pasa, lo guarda.
 *
 * El orden importa: primero se verifica, después se escribe. Guardar un PDF que
 * no corresponde a la receta sería peor que no guardar nada, porque quedaría
 * exhibido como el documento legal de esa prescripción.
 */
export async function guardarRecetaFirmada(
  medplum: MedplumClient,
  params: {
    recetaId: string;
    requests: MedicationRequest[];
    patient: Patient;
    practitioner: Practitioner;
    firmado: Uint8Array;
    /** Bytes regenerados de la MISMA receta (generación determinista). */
    esperado: Uint8Array;
    filename: string;
  }
): Promise<RecetaFirmadaGuardada> {
  const verificacion = await verificarPdfFirmado({
    firmado: params.firmado,
    esperado: params.esperado,
    cuilEsperado: identifierIn(params.practitioner.identifier, CUIL_SYSTEMS),
  });
  if (verificacion.problemas.length > 0) {
    throw new RecetaFirmadaRechazadaError(verificacion);
  }

  const binary = await medplum.createBinary({
    data: params.firmado,
    filename: params.filename,
    contentType: 'application/pdf',
  });

  const bundle = buildRecetaFirmadaBundle({
    recetaId: params.recetaId,
    requests: params.requests,
    patient: params.patient,
    practitioner: params.practitioner,
    binaryUrl: `Binary/${binary.id}`,
    filename: params.filename,
    signatureData: base64DelPkcs7(params.firmado) ?? '',
    firmadoEl: fechaPdfAIso(verificacion.firmadoEl),
  });
  await medplum.executeBatch(bundle);

  return { verificacion, binaryUrl: `Binary/${binary.id}` };
}

/**
 * El PKCS#7 del PDF, en base64, para Signature.data. Devuelve undefined si el
 * archivo no tiene firma legible — pero para cuando se llama, verificar ya
 * pasó, así que en la práctica siempre está.
 */
export function base64DelPkcs7(firmado: Uint8Array): string | undefined {
  const info = parseSignedPdf(firmado);
  return info ? base64(info.pkcs7) : undefined;
}

/**
 * base64 de un buffer, de a tandas. `String.fromCharCode(...bytes)` con un
 * PKCS#7 real (15 kB) desborda la pila de argumentos: el certificado del
 * Estado no entra de un saque.
 */
function base64(bytes: Uint8Array): string {
  let binario = '';
  const TANDA = 0x8000;
  for (let i = 0; i < bytes.length; i += TANDA) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TANDA));
  }
  return btoa(binario);
}

/** La receta ya tiene sello propio: sin eso no hay nada que cotejar. */
export function tieneSello(requests: MedicationRequest[]): boolean {
  return requests.some((r) => Boolean(getSelloReceta(r)));
}

function nombreDe(p: Practitioner): string {
  const n = p.name?.[0];
  return n ? [n.prefix?.join(' '), n.given?.join(' '), n.family].filter(Boolean).join(' ') : 'Profesional';
}

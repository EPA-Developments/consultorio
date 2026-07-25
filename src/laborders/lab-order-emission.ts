// Recetario Fase 2 — núcleo de EMISIÓN de la orden de laboratorio.
//
// Modela la firma del profesional y el sellado de integridad de una orden, con
// recursos FHIR estándar (Provenance + Signature), de forma que sirva a los dos
// escenarios posibles (ver docs/RECETARIO-FASE2-LEGAL.md):
//   - firma ELECTRÓNICA (mecanismo propio de autenticación + hash de contenido)
//   - firma DIGITAL (Ley 25.506, certificado de una AC licenciada)
// La estructura es la misma; cambia qué va en Signature.type y Signature.data.
// Cuál corresponde es una consulta legal abierta y BLOQUEANTE (§4.3.8 del informe).
//
// ⚠️ HONESTIDAD REGULATORIA — leer antes de tocar esto:
// Firmar acá NO vuelve la orden legalmente válida. La validez requiere que la
// plataforma esté inscripta en el ReNaPDiS y, según el caso, que el CUIR lo
// asigne el sistema nacional. Por eso el estado de emisión es explícito y la
// impresión debe declarar el estado real. NUNCA marcar una orden como
// 'legally-emitted' sin inscripción efectiva y CUIR asignado: sería declarar
// una validez que no existe.
import type { Practitioner, Provenance, Reference, ServiceRequest, Signature } from '@medplum/fhirtypes';
import { MATRICULA_SYSTEM } from '../ckm/argentina';
import { REQUISITION_SYSTEM } from './lab-order';

/** Estado de emisión de una orden. El orden importa: cada uno agrega garantías. */
export type EmissionStatus =
  /** Documento de trabajo. Sin firma. No tiene ninguna validez. */
  | 'draft'
  /** Firmada por el profesional con nuestro mecanismo, con sello de integridad.
   *  Trazable y verificable, pero AÚN NO es una orden electrónica legal. */
  | 'signed-internal'
  /** Emitida legalmente: plataforma inscripta en ReNaPDiS y CUIR asignado. */
  | 'legally-emitted';

export interface EmissionStatusInfo {
  label: string;
  /** Texto que se imprime en el documento. Debe ser veraz sobre la validez. */
  legend: string;
  color: string;
}

export const EMISSION_STATUS: Record<EmissionStatus, EmissionStatusInfo> = {
  draft: {
    label: 'Borrador',
    legend:
      'Documento de trabajo. No constituye una orden electrónica con validez legal (Ley 27.553 y Res. 2214/2025).',
    color: 'gray',
  },
  'signed-internal': {
    label: 'Firmada',
    legend:
      'Firmada por el profesional y sellada contra modificaciones. Pendiente de emisión por plataforma inscripta en el ReNaPDiS.',
    color: 'orange',
  },
  'legally-emitted': {
    label: 'Emitida',
    legend: 'Orden electrónica emitida por plataforma inscripta en el ReNaPDiS.',
    color: 'teal',
  },
};

// ── Identificadores ─────────────────────────────────────────────────────────

/**
 * `system` del CUIR (Código Único de Identificación de Receta). El VALOR lo
 * asigna el sistema nacional una vez que la plataforma está inscripta: acá solo
 * se guarda el que nos devuelvan. No se inventa localmente.
 */
export const CUIR_SYSTEM = 'https://salud.gob.ar/renapdis/cuir';

/** `system` del sello de integridad propio (hash del contenido de la orden). */
export const SELLO_SYSTEM = 'https://bio.medplum.com.ar/fhir/sid/sello-orden';

/** Lee el CUIR de una orden, si el sistema nacional ya lo asignó. */
export function getCuir(request: ServiceRequest): string | undefined {
  return request.identifier?.find((i) => i.system === CUIR_SYSTEM)?.value;
}

/** Lee el sello de integridad (hash) de una orden. */
export function getSello(request: ServiceRequest): string | undefined {
  return request.identifier?.find((i) => i.system === SELLO_SYSTEM)?.value;
}

/**
 * Deriva el estado de emisión de una orden a partir de sus datos, sin adivinar:
 * CUIR presente => emitida legalmente; sello + firma registrada => firmada;
 * si no, borrador.
 */
export function emissionStatusOf(request: ServiceRequest, hasSignature: boolean): EmissionStatus {
  if (getCuir(request)) {
    return 'legally-emitted';
  }
  if (hasSignature && getSello(request)) {
    return 'signed-internal';
  }
  return 'draft';
}

// ── Sello de integridad ─────────────────────────────────────────────────────

/**
 * Serializa el contenido jurídicamente relevante de una orden a una cadena
 * canónica y determinista, para hashear. Solo entra lo que no puede cambiar sin
 * invalidar la firma: paciente, profesional, requisición, fecha y los estudios
 * (ordenados, para que el mismo pedido produzca siempre el mismo sello).
 */
export function canonicalOrderContent(requests: ServiceRequest[]): string {
  if (requests.length === 0) {
    return '';
  }
  const first = requests[0];
  const requisition = first.requisition?.value ?? '';
  const subject = first.subject?.reference ?? '';
  const requester = first.requester?.reference ?? '';
  const authored = first.authoredOn ?? '';
  const items = requests
    .map((r) => `${r.code?.coding?.[0]?.code ?? ''}|${r.code?.text ?? ''}`)
    .sort((a, b) => a.localeCompare(b))
    .join(';');
  return [requisition, subject, requester, authored, items].join('\n');
}

/**
 * SHA-256 en hexadecimal del texto dado, con Web Crypto (disponible en el
 * navegador y en Node ≥18). Async por diseño de la API.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sello de integridad de una orden: SHA-256 de su contenido canónico. */
export async function sealOrder(requests: ServiceRequest[]): Promise<string> {
  return sha256Hex(canonicalOrderContent(requests));
}

/**
 * Verifica que una orden no haya sido modificada desde su firma: recalcula el
 * sello y lo compara con el guardado. Devuelve false si no hay sello.
 */
export async function verifySeal(requests: ServiceRequest[]): Promise<boolean> {
  const stored = requests.map(getSello).find(Boolean);
  if (!stored) {
    return false;
  }
  return (await sealOrder(requests)) === stored;
}

// ── Firma (Provenance + Signature) ──────────────────────────────────────────

/**
 * Tipo de firma según el marco elegido. `proof-of-origin` es el código estándar
 * FHIR (ValueSet de signature-type, basado en ASTM E1762) para "firma del autor
 * que acredita el origen del documento".
 */
export const SIGNATURE_TYPE_AUTHOR: Signature['type'] = [
  { system: 'urn:iso-astm:E1762-95:2013', code: '1.2.840.10065.1.12.1.1', display: "Author's Signature" },
];

/** Actividad del Provenance: la orden fue firmada/autorizada por el profesional. */
const ACTIVITY_SIGN = {
  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'CREATE', display: 'create' }],
  text: 'Firma y emisión de la orden de laboratorio',
};

export interface SignOrderParams {
  /** Las órdenes (ServiceRequest) de una misma requisición. */
  requests: ServiceRequest[];
  /** Profesional que firma. */
  practitioner: Practitioner;
  /** Momento de la firma (ISO). Se pasa desde afuera: el core es puro. */
  when: string;
  /** Sello de integridad ya calculado (sealOrder). */
  seal: string;
  /**
   * Firma propiamente dicha, en base64. Con firma DIGITAL sería el PKCS#7/CAdES
   * del certificado del profesional. Con firma ELECTRÓNICA puede ir el sello
   * autenticado. Si no hay, se omite `data` y queda el registro de autoría.
   */
  signatureData?: string;
  /** Formato de la firma (ej. 'application/pkcs7-signature'). */
  sigFormat?: string;
}

/**
 * Construye el Provenance que deja registro inmutable de la firma: quién firmó,
 * cuándo, sobre qué recursos y con qué sello de integridad. Es el recurso FHIR
 * estándar para trazabilidad y el que sostiene el requisito de
 * "integridad e inmutabilidad" del Decreto 98/23.
 */
export function buildEmissionProvenance(params: SignOrderParams): Provenance {
  const { requests, practitioner, when, seal } = params;
  const who = { reference: `Practitioner/${practitioner.id}`, display: practitionerDisplay(practitioner) };
  const signature: Signature = {
    type: SIGNATURE_TYPE_AUTHOR,
    when,
    who,
    ...(params.signatureData ? { data: params.signatureData } : {}),
    ...(params.sigFormat ? { sigFormat: params.sigFormat } : {}),
  };

  return {
    resourceType: 'Provenance',
    target: requests.map((r) => ({ reference: `ServiceRequest/${r.id}` }) as Reference<ServiceRequest>),
    recorded: when,
    activity: ACTIVITY_SIGN,
    agent: [
      {
        type: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author' }],
        },
        who,
      },
    ],
    signature: [signature],
    // El sello viaja también acá para poder auditar sin releer las órdenes.
    extension: [{ url: SELLO_SYSTEM, valueString: seal }],
  };
}

function practitionerDisplay(p: Practitioner): string {
  const n = p.name?.[0];
  return n ? [n.prefix?.join(' '), n.given?.join(' '), n.family].filter(Boolean).join(' ') : 'Profesional';
}

/** Matrícula del profesional (la que debe constar en la orden emitida). */
export function practitionerMatricula(p: Practitioner | undefined): string | undefined {
  return p?.identifier?.find((i) => i.system === MATRICULA_SYSTEM)?.value;
}

/**
 * Devuelve los identifiers a escribir en cada ServiceRequest al firmar: agrega
 * el sello preservando los existentes (y sin duplicarlo).
 */
export function withSeal(request: ServiceRequest, seal: string): ServiceRequest['identifier'] {
  const others = (request.identifier ?? []).filter((i) => i.system !== SELLO_SYSTEM);
  return [...others, { system: SELLO_SYSTEM, value: seal }];
}

// ── Verificación pública ────────────────────────────────────────────────────

/** Base de la URL de verificación de una orden (la resuelve el portal). */
export const VERIFICATION_BASE_URL = 'https://bio.medplum.com.ar/verificar';

/**
 * URL de verificación de una orden, para imprimir como QR. Permite que el
 * laboratorio confirme que la orden existe y no fue alterada. Usa el CUIR si ya
 * está asignado; si no, el número de requisición propio.
 */
export function verificationUrl(requests: ServiceRequest[]): string | undefined {
  const first = requests[0];
  if (!first) {
    return undefined;
  }
  const cuir = getCuir(first);
  if (cuir) {
    return `${VERIFICATION_BASE_URL}?cuir=${encodeURIComponent(cuir)}`;
  }
  const requisition = first.requisition?.system === REQUISITION_SYSTEM ? first.requisition.value : undefined;
  return requisition ? `${VERIFICATION_BASE_URL}?orden=${encodeURIComponent(requisition)}` : undefined;
}

/** Días de retención mínima exigidos (Res. 2214/2025: 3 años). */
export const RETENTION_YEARS = 3;

/**
 * Fecha hasta la cual debe conservarse una orden emitida (mínimo legal).
 * Se calcula desde la fecha de emisión.
 */
export function retentionUntil(authoredOn: string): string | undefined {
  const d = new Date(authoredOn);
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  d.setFullYear(d.getFullYear() + RETENTION_YEARS);
  return d.toISOString().slice(0, 10);
}

// Validación de matrícula contra REFEPS, a través del Bus de Interoperabilidad
// del Ministerio de Salud.
//
// Es requisito de aprobación del trámite ReNaPDiS (§5.2 del checklist): los
// datos del profesional deben validarse contra el Registro Federal de
// Profesionales de la Salud.
//
// ⚠️ EL SECRETO NO PUEDE VIVIR EN EL NAVEGADOR. El Bus autentica con un JWT
// firmado en HS256 con el Domain Secret, que es un secreto COMPARTIDO: quien lo
// tiene puede emitir tokens a nombre de BioWellness. Puesto en el front queda en
// el bundle de Vite y lo lee cualquiera. La consulta tiene que salir de un Bot
// de Medplum o de un backend.
//
// Este módulo es puro a propósito: arma los pedidos e interpreta las respuestas,
// pero no firma ni hace red. La firma queda del lado del que tiene el secreto.
//
// ── Sobre las dos versiones del recurso ─────────────────────────────────────
// La guía oficial es la v2.0 (09/2025); las colecciones Postman traen ejemplos
// de la v1. Cambian cosas que importan: en v1 la matrícula se reconocía por
// `identifier.type.text === 'PRO'` y las especialidades eran qualifications
// aparte; en v2 la matrícula se reconoce por el `system` y su estado viene en la
// extensión MatriculaHabilitada. Se leen las dos, porque no sabemos con cuál
// responde hoy cada ambiente.
import type { Bundle, Practitioner, PractitionerQualification } from '@medplum/fhirtypes';

// ── Endpoints ───────────────────────────────────────────────────────────────

/**
 * Hosts del Bus. **No son el mismo en QA y en producción**, aunque el archivo
 * de variables de Postman diga lo contrario: ese `busUrl` no se usa (las
 * colecciones traen la URL escrita) y en el environment de QA quedó apuntando a
 * producción. Tomar el host de acá.
 *
 * La guía escribe el host como `bus.msal.gov.ar` (.gov) y las colecciones como
 * `bus.msal.gob.ar` (.gob). Se usa el de las colecciones, que es el artefacto
 * ejecutable — conviene confirmarlo con soporte@sisa.msal.gov.ar.
 */
export const BUS_URLS = {
  qa: 'https://bus-test.msal.gob.ar',
  prod: 'https://bus.msal.gob.ar',
} as const;

export type BusEnvironment = keyof typeof BUS_URLS;

/** `system` con el que REFEPS identifica al profesional. */
export const REFEPS_SYSTEM = 'https://sisa.msal.gov.ar/REFEPS';
/** `system` del DNI en las consultas al Bus. */
export const RENAPER_DNI_SYSTEM = 'https://www.renaper.org.ar/dni';
/** `system` del CUIL en las consultas al Bus. */
export const ANSES_CUIL_SYSTEM = 'https://www.anses.org.ar/cuil';

/**
 * En la v1 el DNI volvía con `https://www.renaper.org.ar` (sin `/dni`). Se
 * aceptan los dos al leer para no depender de qué versión conteste.
 */
const DNI_SYSTEMS_ACEPTADOS = [RENAPER_DNI_SYSTEM, 'https://www.renaper.org.ar'];

// ── Autenticación ───────────────────────────────────────────────────────────

/** Scope del servicio de profesionales. Se pide uno por servicio, no todos juntos. */
export const SCOPE_PRACTITIONER = 'Practitioner/*.read';

/**
 * Vigencia de la aserción de cliente. El texto de la guía dice
 * `currentTimestamp + 6000000`, pero el JWT de ejemplo que ella misma incluye
 * decodifica a exactamente **una hora** (iat 1757196526 → exp 1757200126). Se
 * sigue el ejemplo, que es el dato duro.
 */
export const CLIENT_ASSERTION_TTL_SECONDS = 3600;

export interface ClientAssertionClaims {
  iss: string;
  iat: number;
  exp: number;
  aud: string;
  sub: string;
  name: string;
  ident: string;
  role: string;
}

/**
 * Claims del JWT de client assertion, con los valores que espera el Bus.
 *
 * `aud`, `sub`, `name`, `ident` y `role` van con esos literales: así están en la
 * guía y en la colección. No son datos nuestros ni hay que completarlos.
 *
 * ⚠️ `iat` y `exp` van en SEGUNDOS. La guía dice "milisegundos desde el 1 de
 * enero de 1970", pero su propio JWT de ejemplo trae segundos (1757196526 es
 * septiembre de 2025; en milisegundos sería 1970). Mandar milisegundos daría un
 * token con fecha imposible.
 */
export function buildClientAssertionClaims(params: {
  issuer: string;
  nowSeconds: number;
  ttlSeconds?: number;
}): ClientAssertionClaims {
  const iat = Math.floor(params.nowSeconds);
  return {
    iss: params.issuer,
    iat,
    exp: iat + (params.ttlSeconds ?? CLIENT_ASSERTION_TTL_SECONDS),
    aud: 'aud',
    sub: 'sub',
    name: 'name',
    ident: 'ident',
    role: 'role',
  };
}

export interface AuthRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/** Pedido de token. El `clientAssertion` es el JWT ya firmado por el llamador. */
export function buildAuthRequest(params: {
  env: BusEnvironment;
  clientAssertion: string;
  scope?: string;
}): AuthRequest {
  return {
    url: `${BUS_URLS[params.env]}/bus-auth/v2/auth`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'client_credentials',
      scope: params.scope ?? SCOPE_PRACTITIONER,
      clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      clientAssertion: params.clientAssertion,
    }),
  };
}

/**
 * Token de la respuesta de autenticación.
 *
 * La guía dice que el atributo se llama `token`; el script de la colección lee
 * `accessToken`. Se aceptan los dos: si el ambiente usa uno u otro, funciona
 * igual, y si no viene ninguno es un error explícito y no un token vacío.
 */
export function accessTokenFrom(body: unknown): string | undefined {
  const b = body as { token?: unknown; accessToken?: unknown } | null;
  for (const candidato of [b?.token, b?.accessToken]) {
    if (typeof candidato === 'string' && candidato) {
      return candidato;
    }
  }
  return undefined;
}

// ── Búsqueda ────────────────────────────────────────────────────────────────

export type PractitionerQuery =
  | { by: 'dni'; dni: string; gender: 'male' | 'female' }
  | { by: 'cuil'; cuil: string }
  | { by: 'refeps'; code: string }
  | { by: 'id'; id: string };

/** El CUIL viaja sin guiones. */
export function normalizeCuil(cuil: string): string {
  return cuil.replace(/\D/g, '');
}

/**
 * URL de búsqueda. El identificador va como token FHIR `system|valor`.
 *
 * La búsqueda por id interno existe pero la guía **desaconseja usarla**: ese id
 * no tiene garantía de mantenerse en el tiempo.
 */
export function practitionerSearchUrl(env: BusEnvironment, query: PractitionerQuery): string {
  const base = `${BUS_URLS[env]}/fhir/Practitioner`;
  if (query.by === 'id') {
    return `${base}/${encodeURIComponent(query.id)}`;
  }
  const params = new URLSearchParams();
  if (query.by === 'dni') {
    params.set('identifier', `${RENAPER_DNI_SYSTEM}|${query.dni}`);
    params.set('gender', query.gender);
  } else if (query.by === 'cuil') {
    params.set('identifier', `${ANSES_CUIL_SYSTEM}|${normalizeCuil(query.cuil)}`);
  } else {
    params.set('identifier', `${REFEPS_SYSTEM}|${query.code}`);
  }
  return `${base}?${params.toString()}`;
}

/** Cabeceras de la consulta, con el token obtenido antes. */
export function searchHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/fhir+json' };
}

/**
 * Practitioners de una respuesta.
 *
 * Las búsquedas por query param devuelven un Bundle; la búsqueda por id
 * devuelve el Practitioner suelto. Se aceptan las dos formas.
 */
export function practitionersFrom(body: Bundle | Practitioner | undefined): Practitioner[] {
  if (!body) {
    return [];
  }
  if (body.resourceType === 'Practitioner') {
    return [body];
  }
  return (body.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is Practitioner => r?.resourceType === 'Practitioner');
}

// ── Lectura de la respuesta ─────────────────────────────────────────────────

const EXT_MATRICULA_HABILITADA = 'matriculahabilitada';
const EXT_JURISDICCION = 'jurisdmatricula';
const EXT_ESPECIALIDAD = 'especialidadmatricula';

/** Las URLs de extensión mezclan mayúsculas entre la guía y sus ejemplos. */
function extensionsNamed(q: PractitionerQualification, name: string): NonNullable<typeof q.extension> {
  return (q.extension ?? []).filter((e) => e.url?.split('/').pop()?.toLowerCase() === name);
}

export interface RefepsMatricula {
  /** Número tal como lo devuelve REFEPS (sin prefijo MN/MP). */
  value: string;
  /** Profesión de esa matrícula, ej. "Médico". */
  profession?: string;
  /** Jurisdicción que la otorgó, ej. "CABA". */
  jurisdiction?: string;
  /** Quién la emitió, ej. "MINISTERIO DE SALUD DE BUENOS AIRES". */
  issuer?: string;
  /** Especialidades asociadas a ESTA matrícula (v2). */
  specialties: string[];
  since?: string;
  /** Fin de vigencia; ausente significa sin vencimiento registrado. */
  until?: string;
  /**
   * Estado de habilitación según la extensión MatriculaHabilitada (v2).
   * `undefined` si la respuesta no la trae (v1), que NO es lo mismo que `false`.
   */
  enabled?: boolean;
}

/** Una qualification es una matrícula si su identifier es del sistema REFEPS. */
function matriculaIdentifier(q: PractitionerQualification): string | undefined {
  for (const ident of q.identifier ?? []) {
    if (!ident.value) {
      continue;
    }
    // v2: system 'https://sisa.msal.gov.ar/REFEPS/35-02' (profesión-jurisdicción).
    if (ident.system?.startsWith(REFEPS_SYSTEM)) {
      return ident.value;
    }
    // v1: se distinguía por type.text 'PRO' (matrícula) vs 'ESP' (especialidad).
    if (ident.type?.text === 'PRO') {
      return ident.value;
    }
  }
  return undefined;
}

/**
 * Matrículas del profesional.
 *
 * **Un profesional puede tener varias** —el ejemplo oficial trae dos, de años
 * distintos— así que validar contra la primera dejaría afuera matrículas
 * legítimas.
 */
export function matriculasOf(practitioner: Practitioner): RefepsMatricula[] {
  const out: RefepsMatricula[] = [];
  for (const q of practitioner.qualification ?? []) {
    const value = matriculaIdentifier(q);
    if (!value) {
      continue;
    }
    const habilitada = extensionsNamed(q, EXT_MATRICULA_HABILITADA)[0]?.valueBoolean;
    out.push({
      value,
      profession: q.code?.coding?.find((c) => c.display)?.display,
      jurisdiction: extensionsNamed(q, EXT_JURISDICCION)[0]?.valueCoding?.display,
      issuer: q.issuer?.display,
      specialties: extensionsNamed(q, EXT_ESPECIALIDAD)
        .map((e) => e.valueCoding?.display)
        .filter((x): x is string => Boolean(x)),
      since: q.period?.start,
      until: q.period?.end,
      enabled: habilitada,
    });
  }
  return out;
}

/**
 * Especialidades del profesional. En v2 cuelgan de cada matrícula; en v1 eran
 * qualifications aparte con `type.text === 'ESP'`.
 */
export function especialidadesOf(practitioner: Practitioner): string[] {
  const deMatriculas = matriculasOf(practitioner).flatMap((m) => m.specialties);
  const v1 = (practitioner.qualification ?? [])
    .filter((q) => (q.identifier ?? []).some((i) => i.type?.text === 'ESP'))
    .map((q) => q.code?.coding?.find((c) => c.display)?.display)
    .filter((x): x is string => Boolean(x));
  return [...new Set([...deMatriculas, ...v1])];
}

/** DNI del profesional según REFEPS, si vino. */
export function dniOf(practitioner: Practitioner): string | undefined {
  return practitioner.identifier?.find((i) => i.system && DNI_SYSTEMS_ACEPTADOS.includes(i.system))?.value;
}

/** Código REFEPS del profesional (identificador del registro). */
export function refepsCodeOf(practitioner: Practitioner): string | undefined {
  return practitioner.identifier?.find((i) => i.system === REFEPS_SYSTEM)?.value;
}

// ── Comparación con lo que tenemos cargado ──────────────────────────────────

/** Solo los dígitos: nosotros guardamos "MN 12345" y REFEPS devuelve "12345". */
export function matriculaDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Compara la matrícula declarada con una de REFEPS. Por dígitos, porque el
 * prefijo de jurisdicción (MN/MP) es nuestro y no del registro: REFEPS devuelve
 * el número pelado y la jurisdicción por separado.
 */
export function matriculaMatches(declared: string, fromRefeps: string): boolean {
  const a = matriculaDigits(declared);
  return a.length > 0 && a === matriculaDigits(fromRefeps);
}

export type RefepsVerdict =
  | 'verificado'
  | 'no-encontrado'
  | 'profesional-inactivo'
  | 'matricula-no-coincide'
  | 'matricula-no-habilitada'
  | 'matricula-vencida';

export interface RefepsVerification {
  verdict: RefepsVerdict;
  /** Explicación para mostrarle al profesional. */
  message: string;
  /** La matrícula de REFEPS que coincidió, si hubo. */
  matched?: RefepsMatricula;
  /** Todas las encontradas, para poder mostrar cuáles sí figuran. */
  found: RefepsMatricula[];
  profession?: string;
  specialties: string[];
}

/**
 * Verifica una matrícula contra lo que devolvió REFEPS.
 *
 * Solo `verificado` habilita a emitir. Los demás estados se distinguen entre sí
 * a propósito: "no figura en el registro", "está vencida" y "el profesional
 * está inactivo" piden acciones distintas, y un mensaje genérico dejaría al
 * médico sin saber qué arreglar.
 *
 * Un caso NO llega hasta acá: que el Bus no conteste. Eso es un error de red del
 * llamador y no debe confundirse con un rechazo — tratar una caída del Bus como
 * "matrícula inválida" bloquearía a un profesional legítimo.
 */
export function verifyMatricula(params: {
  practitioners: Practitioner[];
  declaredMatricula: string;
  /** Para evaluar vencimientos. */
  nowIso: string;
}): RefepsVerification {
  const practitioner = params.practitioners[0];
  if (!practitioner) {
    return {
      verdict: 'no-encontrado',
      message: 'REFEPS no devolvió ningún profesional para esos datos.',
      found: [],
      specialties: [],
    };
  }

  const found = matriculasOf(practitioner);
  const base = {
    found,
    specialties: especialidadesOf(practitioner),
    profession: found.find((m) => m.profession)?.profession,
  };

  if (practitioner.active === false) {
    return { ...base, verdict: 'profesional-inactivo', message: 'El profesional figura como inactivo en REFEPS.' };
  }

  const coincidencias = found.filter((m) => matriculaMatches(params.declaredMatricula, m.value));
  if (coincidencias.length === 0) {
    const lista = found.map((m) => m.value).join(', ');
    return {
      ...base,
      verdict: 'matricula-no-coincide',
      message: found.length
        ? `La matrícula cargada no coincide con las de REFEPS (${lista}).`
        : 'El profesional existe en REFEPS pero no tiene matrículas registradas.',
    };
  }

  // Alcanza con que UNA de las coincidencias esté en condiciones.
  const vigente = coincidencias.find((m) => m.enabled !== false && (!m.until || m.until > params.nowIso));
  if (vigente) {
    const detalle = [vigente.profession, vigente.jurisdiction].filter(Boolean).join(', ');
    return {
      ...base,
      verdict: 'verificado',
      matched: vigente,
      message: `Matrícula verificada en REFEPS${detalle ? ` (${detalle})` : ''}.`,
    };
  }

  // No hay ninguna en condiciones: se informa el motivo de la primera.
  const problema = coincidencias[0];
  if (problema.enabled === false) {
    return {
      ...base,
      verdict: 'matricula-no-habilitada',
      matched: problema,
      message: 'La matrícula figura en REFEPS pero no está habilitada.',
    };
  }
  return {
    ...base,
    verdict: 'matricula-vencida',
    matched: problema,
    message: `La matrícula figura en REFEPS pero venció el ${problema.until?.slice(0, 10)}.`,
  };
}

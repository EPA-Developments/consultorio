// Bot: verifica la matrícula de un profesional contra REFEPS, vía el Bus de
// Interoperabilidad del Ministerio de Salud.
//
// Se dispara MANUALMENTE (medplum.executeBot desde el dashboard), no por
// Subscription: la verificación se pide antes de emitir una orden, no cada vez
// que alguien toca un Practitioner.
//
// POR QUÉ ES UN BOT Y NO CÓDIGO DEL FRONT: el Domain Secret firma tokens a
// nombre de BioWellness. En una app Vite quedaría dentro del bundle, legible
// por cualquiera con las herramientas de desarrollo. Acá vive en los secrets
// del Bot, del lado del servidor, y nunca sale.
//
// El bot NO escribe nada: devuelve el veredicto y el dashboard decide. Que la
// verificación no tenga efectos hace que se la pueda pedir cuantas veces haga
// falta sin ensuciar la historia.
//
// Secrets del Bot:
// - REFEPS_DOMAIN_SECRET (requerido): el Domain Secret del ABM de Dominios.
// - REFEPS_DOMAIN_URL (requerido): nuestro issuer, el mismo dado de alta.
// - REFEPS_ENV (opcional): 'qa' (default) o 'prod'.
import { createHmac } from 'node:crypto';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Bundle, Practitioner } from '@medplum/fhirtypes';
import { CUIL_SYSTEM, DNI_SYSTEM, MATRICULA_SYSTEM } from '../../ckm/argentina';
import {
  accessTokenFrom,
  buildAuthRequest,
  buildClientAssertionClaims,
  practitionerSearchUrl,
  practitionersFrom,
  searchHeaders,
  verifyMatricula,
} from '../../laborders/refeps';
import type { BusEnvironment, PractitionerQuery, RefepsVerification } from '../../laborders/refeps';

/** Lo que devuelve el bot: el veredicto más cómo se llegó a él. */
export interface RefepsVerifyResult extends RefepsVerification {
  /** Con qué criterio se buscó, para poder reproducir la consulta. */
  queriedBy?: PractitionerQuery['by'];
  environment: BusEnvironment;
  checkedAt: string;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** Firma el JWT de client assertion en HS256, como pide la guía. */
export function signClientAssertion(claims: object, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function identifierValue(p: Practitioner, system: string): string | undefined {
  return p.identifier?.find((i) => i.system === system)?.value;
}

/**
 * Con qué buscar al profesional en REFEPS.
 *
 * Se prefiere el DNI porque es el dato que siempre está cargado, pero el
 * servicio EXIGE el género junto con él: sin género la búsqueda no es válida y
 * hay que caer al CUIL. El id interno del Bus queda descartado: la guía
 * desaconseja usarlo porque no garantiza persistir.
 */
export function queryFor(practitioner: Practitioner): PractitionerQuery | undefined {
  const dni = identifierValue(practitioner, DNI_SYSTEM);
  const gender = practitioner.gender;
  if (dni && (gender === 'male' || gender === 'female')) {
    return { by: 'dni', dni, gender };
  }
  const cuil = identifierValue(practitioner, CUIL_SYSTEM);
  if (cuil) {
    return { by: 'cuil', cuil };
  }
  return undefined;
}

/** Resuelve el Practitioner desde el input del bot (varias formas posibles). */
async function resolvePractitioner(medplum: MedplumClient, input: unknown): Promise<Practitioner | undefined> {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const obj = input as Record<string, unknown>;
  if (obj.resourceType === 'Practitioner') {
    return obj as unknown as Practitioner;
  }
  const id = typeof obj.practitionerId === 'string' ? obj.practitionerId : undefined;
  if (id) {
    return medplum.readResource('Practitioner', id);
  }
  const ref = typeof obj.reference === 'string' ? obj.reference : undefined;
  if (ref?.startsWith('Practitioner/')) {
    return medplum.readResource('Practitioner', ref.slice('Practitioner/'.length));
  }
  return undefined;
}

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<RefepsVerifyResult> {
  const secret = event.secrets['REFEPS_DOMAIN_SECRET']?.valueString;
  const issuer = event.secrets['REFEPS_DOMAIN_URL']?.valueString;
  if (!secret || !issuer) {
    throw new Error('Faltan los secrets REFEPS_DOMAIN_SECRET y REFEPS_DOMAIN_URL en el bot.');
  }
  const environment: BusEnvironment = event.secrets['REFEPS_ENV']?.valueString === 'prod' ? 'prod' : 'qa';
  const checkedAt = new Date().toISOString();

  const practitioner = await resolvePractitioner(medplum, event.input);
  if (!practitioner) {
    throw new Error('No se pudo resolver el profesional a verificar.');
  }

  const declaredMatricula = identifierValue(practitioner, MATRICULA_SYSTEM);
  if (!declaredMatricula) {
    return {
      verdict: 'matricula-no-coincide',
      message: 'El profesional no tiene matrícula cargada: no hay nada que verificar contra REFEPS.',
      found: [],
      specialties: [],
      environment,
      checkedAt,
    };
  }

  const query = queryFor(practitioner);
  if (!query) {
    return {
      verdict: 'no-encontrado',
      message:
        'Faltan datos para consultar REFEPS: hace falta DNI con género, o CUIL. Completar la ficha del profesional.',
      found: [],
      specialties: [],
      environment,
      checkedAt,
    };
  }

  // 1. Token. Un scope por servicio: pedirlos todos juntos hace que se rechace.
  const assertion = signClientAssertion(
    buildClientAssertionClaims({ issuer, nowSeconds: Date.now() / 1000 }),
    secret
  );
  const authRequest = buildAuthRequest({ env: environment, clientAssertion: assertion });
  const authResponse = await fetch(authRequest.url, {
    method: authRequest.method,
    headers: authRequest.headers,
    body: authRequest.body,
  });
  if (!authResponse.ok) {
    throw new Error(`El Bus rechazó la autenticación (HTTP ${authResponse.status}).`);
  }
  const token = accessTokenFrom(await authResponse.json());
  if (!token) {
    throw new Error('El Bus respondió sin token de acceso.');
  }

  // 2. Consulta.
  const searchResponse = await fetch(practitionerSearchUrl(environment, query), {
    headers: searchHeaders(token),
  });
  // 404 es "no está en el registro", no una falla: se informa como veredicto.
  if (searchResponse.status === 404) {
    return {
      verdict: 'no-encontrado',
      message: 'REFEPS no tiene registrado a este profesional con esos datos.',
      found: [],
      specialties: [],
      queriedBy: query.by,
      environment,
      checkedAt,
    };
  }
  if (!searchResponse.ok) {
    // Una caída del Bus NO es una matrícula inválida. Se propaga como error
    // para que el dashboard lo distinga y no bloquee a un profesional legítimo.
    throw new Error(`El Bus no respondió a la consulta (HTTP ${searchResponse.status}).`);
  }

  const body = (await searchResponse.json()) as Bundle | Practitioner;
  const verification = verifyMatricula({
    practitioners: practitionersFrom(body),
    declaredMatricula,
    nowIso: checkedAt,
  });

  return { ...verification, queriedBy: query.by, environment, checkedAt };
}

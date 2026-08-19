// El gate de emisión: lo que se verifica ANTES de que exista cualquier
// prescripción, sea una orden de laboratorio o una receta de medicamentos.
//
// Vive en un módulo propio porque el acto legal es el mismo con distinto
// objeto: un profesional matriculado y habilitado firma una indicación. Si la
// orden y la receta validaran cada una por su cuenta, divergirían — y acá
// divergir significa que un camino bloquea a un médico que el otro deja pasar.
//
// DOS PASOS, en orden:
// 1. LOCAL: matrícula cargada y con forma de matrícula. Sin red.
// 2. REFEPS: la matrícula existe y está habilitada en el registro federal
//    (requisito §5.2 del trámite ReNaPDiS). Va por el bot refeps-verify.
//
// La política con REFEPS distingue tres resultados:
// - verificado -> se emite, y la constancia viaja en el documento.
// - rechazo del registro -> BLOQUEA con el motivo. Acá REFEPS contestó.
// - unavailable -> EMITE IGUAL, dejando constancia. Un 503 del Estado no
//   convierte a un profesional matriculado en uno que no lo está.
import type { MedplumClient } from '@medplum/core';
import type { Practitioner } from '@medplum/fhirtypes';
import { checkPractitionerForEmission, EmissionBlockedError } from './practitioner-validation';
import { checkRefeps, isRejected } from './refeps-client';
import type { RefepsCheckResult } from './refeps-client';

/**
 * Extensión con el resultado de la verificación REFEPS al momento de emitir.
 * valueString: 'verificado' o 'no-verificable'. Los rechazos no llegan acá:
 * bloquean antes de que exista el documento.
 */
export const EXT_REFEPS_VERIFICACION = 'https://biowellness.ar/fhir/StructureDefinition/refeps-verificacion';

export interface EmisorValidado {
  practitioner: Practitioner;
  refeps: RefepsCheckResult;
}

/**
 * Valida al profesional para emitir. Lanza EmissionBlockedError si no puede;
 * si puede, devuelve el resultado REFEPS para que el emisor deje constancia.
 */
export async function validarEmisor(medplum: MedplumClient): Promise<EmisorValidado> {
  const profile = medplum.getProfile();
  const practitioner = profile?.resourceType === 'Practitioner' ? profile : undefined;

  const check = checkPractitionerForEmission(practitioner);
  if (!check.canEmit) {
    throw new EmissionBlockedError(check.problems);
  }

  const refeps = await checkRefeps(medplum, practitioner as Practitioner);
  if (isRejected(refeps)) {
    throw new EmissionBlockedError([
      `REFEPS rechazó la emisión: ${refeps.verification?.message ?? refeps.verification?.verdict}`,
    ]);
  }
  return { practitioner: practitioner as Practitioner, refeps };
}

/** La constancia humana que viaja en la nota del documento (y se imprime). */
export function constanciaRefeps(refeps: RefepsCheckResult, fechaIso: string): string {
  if (refeps.verification?.verdict === 'verificado') {
    return `Matrícula verificada en REFEPS (${fechaIso.slice(0, 10)})`;
  }
  // Decía "(registro sin respuesta)" en todos los casos, y eso afirma una causa
  // que no se comprobó: la verificación también queda sin hacer cuando el bot
  // refeps-verify no está desplegado en el proyecto, que no es culpa de REFEPS.
  // El documento dice lo que es cierto —no se verificó, y cuándo— y el motivo
  // exacto va al profesional por pantalla, no impreso en la orden.
  return `Matrícula sin verificar contra REFEPS al emitir (${fechaIso.slice(0, 10)})`;
}

/** El valor de la extensión, a partir del resultado. */
export function valorVerificacion(refeps: RefepsCheckResult): 'verificado' | 'no-verificable' {
  return refeps.verification?.verdict === 'verificado' ? 'verificado' : 'no-verificable';
}

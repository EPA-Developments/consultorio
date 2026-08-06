// Llamada al bot de verificación REFEPS desde el dashboard.
//
// El front no habla con el Bus: no puede, porque el secreto vive en el bot.
// Acá solo se invoca el bot y se interpreta lo que devuelve.
//
// La distinción que importa: un rechazo de REFEPS y una caída del Bus NO son lo
// mismo. Si el servicio no contesta, el profesional no deja de estar
// matriculado, así que ese caso se marca aparte y no bloquea.
import type { MedplumClient } from '@medplum/core';
import type { Practitioner } from '@medplum/fhirtypes';
import type { RefepsVerdict, RefepsVerification } from './refeps';

/** Nombre con el que quedó deployado el bot. */
export const REFEPS_BOT_NAME = 'refeps-verify';

export interface RefepsCheckResult {
  /** El veredicto del registro, si se pudo consultar. */
  verification?: RefepsVerification & { queriedBy?: string; environment?: string; checkedAt?: string };
  /**
   * true si no se pudo consultar (bot no deployado, Bus caído, red). NO
   * significa que la matrícula sea inválida.
   */
  unavailable: boolean;
  /** Detalle del problema, para el log y para mostrar como aviso. */
  unavailableReason?: string;
}

/** Solo este veredicto habilita a emitir sin observaciones. */
export function isVerified(result: RefepsCheckResult): boolean {
  return result.verification?.verdict === 'verificado';
}

/**
 * Veredictos que representan un rechazo del registro. Se separan de
 * `unavailable` a propósito: acá REFEPS contestó y dijo que no.
 */
const RECHAZOS: RefepsVerdict[] = [
  'no-encontrado',
  'profesional-inactivo',
  'matricula-no-coincide',
  'matricula-no-habilitada',
  'matricula-vencida',
];

export function isRejected(result: RefepsCheckResult): boolean {
  const v = result.verification?.verdict;
  return v !== undefined && RECHAZOS.includes(v);
}

/**
 * Verifica un profesional contra REFEPS a través del bot.
 *
 * No lanza: si el bot no está disponible devuelve `unavailable`. Bloquear una
 * emisión porque el Bus del Ministerio está caído sería trasladarle al médico un
 * problema que no es suyo.
 */
export async function checkRefeps(
  medplum: MedplumClient,
  practitioner: Practitioner
): Promise<RefepsCheckResult> {
  if (!practitioner.id) {
    return { unavailable: true, unavailableReason: 'El profesional no está guardado todavía.' };
  }
  try {
    // Mismo patrón que el resto del proyecto: se busca el Bot por nombre.
    const bot = await medplum.searchOne('Bot', `name=${REFEPS_BOT_NAME}`);
    if (!bot?.id) {
      return { unavailable: true, unavailableReason: `El bot ${REFEPS_BOT_NAME} no está desplegado en el proyecto.` };
    }
    const verification = (await medplum.executeBot(bot.id, {
      practitionerId: practitioner.id,
    })) as RefepsCheckResult['verification'];

    if (!verification?.verdict) {
      return { unavailable: true, unavailableReason: 'El bot de REFEPS respondió sin veredicto.' };
    }
    return { verification, unavailable: false };
  } catch (err) {
    return { unavailable: true, unavailableReason: err instanceof Error ? err.message : String(err) };
  }
}

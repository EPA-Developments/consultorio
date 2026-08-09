// Validación del profesional antes de emitir una orden.
//
// Son DOS validaciones distintas y conviene no confundirlas:
//
// 1. LOCAL (este módulo): que el profesional tenga matrícula cargada y con
//    forma de matrícula. No necesita red y se puede exigir hoy.
// 2. CONTRA REFEPS (todavía no implementada): que esa matrícula exista y esté
//    vigente en el Registro Federal de Profesionales de la Salud. Es requisito
//    de aprobación del trámite ReNaPDiS (§5.2 del checklist) y necesita el
//    contrato del servicio Practitioner del Bus.
//
// La local no reemplaza a la de REFEPS: una matrícula bien formada puede no
// existir. Pero emitir sin matrícula alguna es un defecto propio, no una
// brecha regulatoria, y ese sí se puede cerrar ya.
import type { Practitioner } from '@medplum/fhirtypes';
import { identifierIn, MATRICULA_SYSTEMS } from '../ckm/argentina';

/**
 * Forma habitual de la matrícula argentina: MN (Nacional) o MP (Provincial)
 * seguida del número. Hay jurisdicciones que usan otros prefijos, así que no
 * matchear esto NO invalida: solo se señala.
 */
export const MATRICULA_MN_MP = /^M[NP]\s*\d{3,6}$/i;

/** Al menos un dígito: sin números no es una matrícula. */
const TIENE_DIGITOS = /\d/;

export interface MatriculaCheck {
  /** Valor normalizado (mayúsculas, un solo espacio). */
  normalized?: string;
  /** true si se puede emitir con esta matrícula. */
  valid: boolean;
  /** Motivo del rechazo, para mostrar al profesional. */
  problem?: string;
  /**
   * Observación que no bloquea: la matrícula sirve pero no tiene la forma
   * MN/MP habitual. Puede ser una jurisdicción con otro formato.
   */
  warning?: string;
}

/**
 * Normaliza: recorta, trata guiones y puntos como separador ("MN-92179" y
 * "M.N. 92179" son la misma matrícula), colapsa espacios y pasa a mayúsculas.
 */
export function normalizeMatricula(value: string): string {
  return value.trim().replace(/[-.]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function checkMatricula(value: string | undefined): MatriculaCheck {
  if (!value || !value.trim()) {
    return { valid: false, problem: 'El profesional no tiene matrícula cargada.' };
  }
  const normalized = normalizeMatricula(value);
  if (!TIENE_DIGITOS.test(normalized)) {
    return { valid: false, normalized, problem: 'La matrícula no contiene ningún número.' };
  }
  if (!MATRICULA_MN_MP.test(normalized)) {
    return {
      valid: true,
      normalized,
      warning: 'La matrícula no tiene el formato MN/MP habitual. Verificar que esté bien cargada.',
    };
  }
  return { valid: true, normalized };
}

/**
 * Matrícula del Practitioner, tal como está cargada. Acepta el system canónico
 * y los sinónimos reales (REFEPS): un profesional con la matrícula bajo
 * http://refeps.msal.gob.ar quedaba como "sin matrícula cargada" y el circuito
 * entero de emisión se le bloqueaba.
 */
export function matriculaOf(practitioner: Practitioner | undefined): string | undefined {
  return identifierIn(practitioner?.identifier, MATRICULA_SYSTEMS);
}

export interface EmissionCheck {
  canEmit: boolean;
  /** Lo que impide emitir. */
  problems: string[];
  /** Lo que conviene revisar pero no impide emitir. */
  warnings: string[];
  matricula?: string;
}

/**
 * Verifica que el profesional esté en condiciones de emitir.
 *
 * Solo mira lo que se puede comprobar sin salir del sistema. Cuando exista la
 * verificación contra REFEPS, se suma acá: un profesional con matrícula bien
 * formada pero inexistente en el registro debería quedar bloqueado igual.
 */
export function checkPractitionerForEmission(practitioner: Practitioner | undefined): EmissionCheck {
  if (!practitioner) {
    return {
      canEmit: false,
      problems: ['No hay un profesional identificado para firmar la orden.'],
      warnings: [],
    };
  }

  const problems: string[] = [];
  const warnings: string[] = [];

  const nombre = practitioner.name?.[0];
  if (!nombre?.family && !nombre?.given?.length && !nombre?.text) {
    problems.push('El profesional no tiene nombre cargado.');
  }

  const matricula = checkMatricula(matriculaOf(practitioner));
  if (!matricula.valid) {
    problems.push(matricula.problem as string);
  }
  if (matricula.warning) {
    warnings.push(matricula.warning);
  }

  return { canEmit: problems.length === 0, problems, warnings, matricula: matricula.normalized };
}

/** Error de emisión bloqueada, para distinguirlo de una falla de red. */
export class EmissionBlockedError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`No se puede emitir la orden: ${problems.join(' ')}`);
    this.name = 'EmissionBlockedError';
    this.problems = problems;
  }
}

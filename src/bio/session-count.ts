// Sesiones acumuladas por terapia, contadas desde los turnos de recepción.
//
// El tope de exposición del HBOT no se mide contra la serie en curso sino
// contra todo lo que el paciente lleva hecho en su vida. Ese número no estaba
// en ningún lado del dashboard: `evaluarTerapia` aceptaba `sesionesAcumuladas`
// y nadie se lo pasaba. Acá sale de los `Appointment` que crea recepción, que
// viven en el mismo proyecto Medplum.
//
// TRES DECISIONES QUE IMPORTAN
//
// 1. NO CONFUNDIR COMPRADO CON ADMINISTRADO. Un turno `booked` está pago y
//    reservado; no dice que el paciente haya entrado a la cámara. Contarlo como
//    sesión es contar facturación disfrazada de registro clínico. Solo cuentan
//    los turnos que llegaron a un estado de "pasó".
//
// 2. ANTE LA DUDA, CONTAR DE MÁS. El tope de 100 sesiones pide *evaluación*, no
//    bloquea. Contar de más cuesta una consulta; contar de menos saltea una
//    evaluación en alguien con exposición oxidativa acumulada. Por eso un turno
//    viejo que quedó en "llegó" o "en curso" y nunca se cerró se cuenta igual.
//
// 3. UN CONTEO INCOMPLETO SE DECLARA, NO SE MUESTRA COMO SI FUERA COMPLETO.
//    El catálogo todavía no tiene todos los códigos de servicio de recepción.
//    Si aparece un turno con un código que no reconoce, el resultado sale
//    marcado como no confiable y con la lista de códigos huérfanos, en vez de
//    devolver un total silenciosamente bajo.
import type { Appointment } from '@medplum/fhirtypes';
import type { OrigenConteo } from './safety';
import { indiceCodigosServicio, SISTEMA_SERVICIO, todasLasTerapias } from './therapy-catalog';
import type { Terapia } from './therapy-catalog';

/**
 * Estados de `Appointment` que significan que la sesión se administró.
 *
 * La agenda de recepción rotula Tentativo / Confirmado / Llegó / En curso /
 * Completado, que son los estados estándar de FHIR en castellano. `fulfilled`
 * es "Completado": el turno se cerró.
 */
const ADMINISTRADA: Appointment['status'][] = ['fulfilled'];

/**
 * Estados que significan que el paciente vino pero el turno nunca se cerró.
 * Solo cuentan si ya pasó la fecha: un turno "en curso" de esta tarde está
 * ocurriendo, no ocurrió.
 */
const SIN_CERRAR: Appointment['status'][] = ['arrived', 'checked-in'];

export interface ConteoSesiones {
  /**
   * Sesiones acumuladas por id de terapia. Solo aparecen las terapias que el
   * catálogo sabe contar; para el resto no hay dato, que no es lo mismo que
   * cero.
   */
  porTerapia: Record<string, number>;
  origenConteo: OrigenConteo;
  /**
   * Turnos contados que el paciente asistió pero recepción nunca cerró. Se
   * incluyen en el total; el número se informa para poder decirlo en pantalla.
   */
  sinCerrar: number;
  /**
   * Códigos de servicio que aparecieron en los turnos y el catálogo no
   * reconoce. Mientras no esté vacío el conteo puede estar subestimado.
   */
  codigosSinMapear: string[];
  /**
   * `false` cuando hay códigos sin mapear. Un conteo no confiable **no se usa
   * para gatear**: es preferible no evaluar el tope a evaluarlo contra un
   * número que sabemos incompleto.
   */
  confiable: boolean;
}

/**
 * Código de servicio de un turno.
 *
 * Recepción lo escribe en una extensión (`EXT.itemCodigo`) cuyo URL literal
 * vive en un módulo del repo de recepción que todavía no vimos. Hasta
 * confirmarlo se busca primero en `serviceType`, que es el lugar nativo de FHIR
 * para esto, y después en cualquier extensión cuyo URL termine en
 * `/itemCodigo`.
 */
export function codigoServicioDeTurno(a: Appointment): string | undefined {
  const deServiceType = a.serviceType
    ?.flatMap((st) => st.coding ?? [])
    .find((c) => c.system === SISTEMA_SERVICIO && c.code)?.code;
  if (deServiceType) {
    return deServiceType;
  }
  return a.extension?.find((e) => e.url.endsWith('/itemCodigo') && e.valueString)?.valueString;
}

/** ¿Este turno representa una sesión que ya ocurrió? */
function sesionOcurrida(a: Appointment, ahora: Date): { cuenta: boolean; sinCerrar: boolean } {
  if (ADMINISTRADA.includes(a.status)) {
    return { cuenta: true, sinCerrar: false };
  }
  if (SIN_CERRAR.includes(a.status)) {
    const inicio = a.start ? new Date(a.start) : undefined;
    const paso = inicio !== undefined && !Number.isNaN(inicio.getTime()) && inicio < ahora;
    return { cuenta: paso, sinCerrar: paso };
  }
  return { cuenta: false, sinCerrar: false };
}

/**
 * Cuenta las sesiones acumuladas por terapia a partir de los turnos del
 * paciente. Recibe TODOS los turnos de su historia, no los de una serie.
 */
export function contarSesiones(
  turnos: Appointment[],
  opciones: { ahora?: Date; terapias?: Terapia[] } = {}
): ConteoSesiones {
  const ahora = opciones.ahora ?? new Date();
  const indice = indiceCodigosServicio(opciones.terapias ?? todasLasTerapias());

  // Las terapias que el catálogo sabe contar arrancan en cero: para ellas
  // "ninguna sesión" es una observación, no una laguna. Las que no declaran
  // códigos quedan fuera del objeto y el motor las trata como sin dato.
  const porTerapia: Record<string, number> = {};
  for (const t of opciones.terapias ?? todasLasTerapias()) {
    if ((t.codigosServicio ?? []).length > 0) {
      porTerapia[t.id] = 0;
    }
  }
  const sinMapear = new Set<string>();
  let sinCerrar = 0;

  for (const turno of turnos) {
    const { cuenta, sinCerrar: abierto } = sesionOcurrida(turno, ahora);
    if (!cuenta) {
      continue;
    }
    const codigo = codigoServicioDeTurno(turno);
    if (!codigo) {
      continue; // Sin código no se puede atribuir: una consulta médica no es una terapia.
    }
    const terapiaId = indice.get(codigo);
    if (!terapiaId) {
      sinMapear.add(codigo);
      continue;
    }
    porTerapia[terapiaId] = (porTerapia[terapiaId] ?? 0) + 1;
    if (abierto) {
      sinCerrar++;
    }
  }

  const codigosSinMapear = [...sinMapear].sort();
  return {
    porTerapia,
    // Los turnos se cierran al administrarse, no al facturarse: esto es
    // registro de asistencia, no de cobranza.
    origenConteo: 'administradas',
    sinCerrar,
    codigosSinMapear,
    confiable: codigosSinMapear.length === 0,
  };
}

/**
 * El conteo listo para `evaluarTerapia`, o `undefined` si no se puede sostener.
 *
 * Devolver `undefined` apaga la evaluación de topes. Es deliberado: el motor
 * trata "no hay conteo" como "no evalúo el tope", y eso es correcto. Lo que
 * sería un error es pasarle ceros: un paciente con cien sesiones que el
 * catálogo no supo atribuir aparecería como si no hubiera hecho ninguna.
 */
export function conteoParaGate(conteo: ConteoSesiones): Record<string, number> | undefined {
  return conteo.confiable ? conteo.porTerapia : undefined;
}

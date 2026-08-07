// Gate de seguridad del Panel Bio: evalúa una terapia contra los datos del
// paciente y devuelve qué se puede hacer hoy.
//
// La diferencia con el motor de elegibilidad del GLP-1 es que acá hay TRES
// resultados posibles, no dos. Una decisión sobre un fármaco se toma una vez;
// una terapia con equipamiento se decide dos veces: si el paciente puede hacer
// el tratamiento, y si puede hacer la sesión de hoy. La fiebre no contraindica
// IHHT: contraindica la sesión de este martes, y el paciente sigue siendo
// candidato.
//
// Puro: recibe los datos ya cargados y devuelve el veredicto. Sin red, sin UI.
import type { Condition } from '@medplum/fhirtypes';
import { conditionMatches } from '../ckm/clinical';
import type { Contraindicacion, LimiteAcumulado, Terapia } from './therapy-catalog';
import { limitesAlcanzados } from './therapy-catalog';

/** Qué se puede hacer con esta terapia, para este paciente, hoy. */
export type Resultado = 'permitir' | 'diferir' | 'bloquear' | 'evaluar';

export const RESULTADO_LABELS: Record<Resultado, { label: string; color: string }> = {
  permitir: { label: 'Sin impedimentos', color: 'teal' },
  evaluar: { label: 'Requiere evaluación', color: 'orange' },
  diferir: { label: 'Diferir la sesión', color: 'blue' },
  bloquear: { label: 'No realizar', color: 'red' },
};

export interface HallazgoSeguridad {
  contraindicacion: Contraindicacion;
  /** Qué Condition del paciente la disparó, para poder mostrarlo. */
  motivo: string;
}

/**
 * De dónde salió el conteo de sesiones. Importa para saber cuánto se le puede
 * creer: la facturación cuenta lo COMPRADO, no lo administrado. Alguien compra
 * un pack de diez y hace seis, o recibe una sesión de cortesía que no se
 * factura. Para mostrarle un total al paciente alcanza; para sostener un
 * umbral de seguridad, no.
 */
export type OrigenConteo = 'administradas' | 'facturacion' | 'desconocido';

export const ORIGEN_CONTEO_LABELS: Record<OrigenConteo, string> = {
  administradas: 'sesiones registradas al administrarse',
  facturacion: 'estimado desde la facturación, no desde el registro clínico',
  desconocido: 'origen del conteo sin determinar',
};

export interface EvaluacionTerapia {
  terapia: Terapia;
  resultado: Resultado;
  /** Topes de exposición acumulada ya alcanzados. */
  limites: LimiteAcumulado[];
  /** Sesiones contadas y de dónde salió el número. */
  sesionesAcumuladas?: number;
  origenConteo?: OrigenConteo;
  /** Hallazgos agrupados por lo que provocan. */
  bloqueos: HallazgoSeguridad[];
  evaluaciones: HallazgoSeguridad[];
  condicionales: HallazgoSeguridad[];
  diferimientos: HallazgoSeguridad[];
  /** Tamizajes obligatorios de la terapia; el sistema no sabe si están hechos. */
  tamizajePendiente: string[];
  mensaje: string;
}

export interface DatosPaciente {
  /** Conditions ACTIVAS del paciente. */
  condiciones: Condition[];
  /** Sesiones acumuladas por id de terapia, a lo largo de TODA la historia. */
  sesionesAcumuladas?: Record<string, number>;
  /** De dónde salió ese conteo. */
  origenConteo?: OrigenConteo;
  /**
   * Situaciones del día que difieren una sesión sin ser antecedentes: fiebre,
   * infección aguda, alcohol. No viven en Conditions porque son transitorias.
   */
  situacionesDelDia?: string[];
}

function textoCondicion(c: Condition): string {
  return c.code?.text ?? c.code?.coding?.find((x) => x.display)?.display ?? 'condición sin nombre';
}

/** Contraindicaciones que aplican, con la Condition que las disparó. */
function hallazgos(terapia: Terapia, datos: DatosPaciente, severidad: Contraindicacion['severidad']): HallazgoSeguridad[] {
  const out: HallazgoSeguridad[] = [];
  for (const c of terapia.contraindicaciones) {
    if (c.severidad !== severidad || !c.icd10) {
      continue;
    }
    const patron = new RegExp(c.icd10);
    const match = datos.condiciones.find((cond) => conditionMatches(cond, patron));
    if (match) {
      out.push({ contraindicacion: c, motivo: textoCondicion(match) });
    }
  }
  return out;
}

/**
 * Las contraindicaciones que difieren se evalúan contra las situaciones del
 * día, no contra Conditions: la fiebre de hoy no queda como antecedente.
 */
function diferimientosDelDia(terapia: Terapia, datos: DatosPaciente): HallazgoSeguridad[] {
  const situaciones = datos.situacionesDelDia ?? [];
  if (situaciones.length === 0) {
    return [];
  }
  return terapia.contraindicaciones
    .filter((c) => c.severidad === 'difiere')
    .flatMap((c) => {
      const match = situaciones.find((s) => c.id.includes(s) || s.includes(c.id));
      return match ? [{ contraindicacion: c, motivo: match }] : [];
    });
}

/**
 * Evalúa una terapia para un paciente.
 *
 * El orden de precedencia importa: bloquear gana sobre diferir, y diferir sobre
 * evaluar. Un paciente con una contraindicación absoluta y además fiebre no
 * tiene que ver "diferir la sesión": tiene que ver que no corresponde la
 * terapia.
 */
export function evaluarTerapia(terapia: Terapia, datos: DatosPaciente): EvaluacionTerapia {
  const bloqueos = hallazgos(terapia, datos, 'bloquea');
  const evaluaciones = hallazgos(terapia, datos, 'evaluacion');
  const condicionales = hallazgos(terapia, datos, 'condicional');
  const diferimientos = diferimientosDelDia(terapia, datos);
  const tamizajePendiente = terapia.tamizajePrevio.filter((t) => t.obligatorio).map((t) => t.texto);

  const sesionesAcumuladas = datos.sesionesAcumuladas?.[terapia.id];
  const limites = sesionesAcumuladas !== undefined ? limitesAlcanzados(terapia, sesionesAcumuladas) : [];

  const base = {
    terapia,
    bloqueos,
    evaluaciones,
    condicionales,
    diferimientos,
    tamizajePendiente,
    limites,
    sesionesAcumuladas,
    origenConteo: datos.origenConteo,
  };

  if (bloqueos.length > 0) {
    return {
      ...base,
      resultado: 'bloquear',
      mensaje: `No corresponde: ${bloqueos.map((h) => h.contraindicacion.texto).join('; ')}.`,
    };
  }
  if (diferimientos.length > 0) {
    return {
      ...base,
      resultado: 'diferir',
      mensaje: `La sesión de hoy se difiere: ${diferimientos.map((h) => h.contraindicacion.texto).join('; ')}. El paciente sigue siendo candidato.`,
    };
  }
  // Un tope de exposición alcanzado exige evaluación aunque los antecedentes
  // estén limpios: el riesgo no viene de lo que el paciente tiene, sino de
  // cuántas sesiones lleva.
  const topes = limites.filter((l) => l.severidad === 'evaluacion');
  if (evaluaciones.length > 0 || condicionales.length > 0 || topes.length > 0) {
    const motivos = [
      ...[...evaluaciones, ...condicionales].map((h) => h.contraindicacion.texto),
      ...topes.map((l) => `${sesionesAcumuladas} sesiones acumuladas: ${l.texto}`),
    ];
    return {
      ...base,
      resultado: 'evaluar',
      mensaje: `Requiere evaluación antes de indicar: ${motivos.join('; ')}.`,
    };
  }
  return {
    ...base,
    resultado: 'permitir',
    mensaje:
      tamizajePendiente.length > 0
        ? 'Sin contraindicaciones en los antecedentes. Verificar el tamizaje previo antes de la primera sesión.'
        : 'Sin contraindicaciones en los antecedentes.',
  };
}

/** Evalúa todo el catálogo de una vez. */
export function evaluarCatalogo(terapias: Terapia[], datos: DatosPaciente): EvaluacionTerapia[] {
  return terapias.map((t) => evaluarTerapia(t, datos));
}

/** Orden para mostrar: primero lo que bloquea, al final lo que está libre. */
const PRIORIDAD: Record<Resultado, number> = { bloquear: 0, evaluar: 1, diferir: 2, permitir: 3 };

export function ordenarPorRiesgo(evaluaciones: EvaluacionTerapia[]): EvaluacionTerapia[] {
  return [...evaluaciones].sort((a, b) => PRIORIDAD[a.resultado] - PRIORIDAD[b.resultado]);
}

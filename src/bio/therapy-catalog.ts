// Catálogo de terapias del Panel Bio.
//
// Mismo principio que el catálogo de 109 biomarcadores: las terapias son DATO
// (data/bio/therapy-definitions.json), no código. Corregir una contraindicación
// no debería requerir un despliegue.
//
// Dos decisiones de modelo que vale explicar:
//
// 1. LOS PARÁMETROS NO COMPARTEN FORMA. Un biomarcador siempre es un número con
//    una unidad; una sesión de HBOT (ATA) y una de Red Light (nm, J/cm²) no se
//    parecen en nada. Por eso cada terapia declara SU lista de parámetros, en
//    vez de forzar un esquema común que no existe.
//
// 2. LA SEVERIDAD TIENE CUATRO VALORES, NO DOS. El material publicado mezcla
//    bajo un solo título "no se realiza / precaución si" cosas que el sistema
//    tiene que separar: lo que bloquea, lo que exige evaluación, lo que depende
//    del caso, y lo que solo difiere la sesión de hoy. La fiebre no
//    contraindica IHHT: contraindica la sesión de este martes.
import definitionsJson from '../../data/bio/therapy-definitions.json';

/** Los tres ejes terapéuticos, que son la taxonomía de la práctica. */
export type Eje = 'rejuvenecer' | 'recuperar' | 'reparar';

export const EJE_LABELS: Record<Eje, string> = {
  rejuvenecer: 'Rejuvenecimiento',
  recuperar: 'Recuperación',
  reparar: 'Reparación',
};

/**
 * Cuánto acto médico hay en la terapia. Es lo que gobierna cuánto gatea el
 * panel — no los ejes, que son una etiqueta de presentación.
 */
export type Medicalizacion = 'acto-medico' | 'evaluacion-medica' | 'bienestar';

export const MEDICALIZACION_LABELS: Record<Medicalizacion, { label: string; color: string }> = {
  'acto-medico': { label: 'Acto médico', color: 'red' },
  'evaluacion-medica': { label: 'Con evaluación médica', color: 'orange' },
  bienestar: { label: 'Bienestar', color: 'teal' },
};

/**
 * Nivel de evidencia POR AFIRMACIÓN, no por terapia: la misma terapia puede
 * tener respaldo sólido para una indicación y ninguno para otra.
 */
export type NivelEvidencia = 'ensayo-humano' | 'senal-consistente-n-pequeno' | 'mecanistico-sin-ensayos' | 'sin-datos';

export const EVIDENCIA_LABELS: Record<NivelEvidencia, { label: string; color: string }> = {
  'ensayo-humano': { label: 'Ensayo en humanos', color: 'teal' },
  'senal-consistente-n-pequeno': { label: 'Señal consistente, n chico', color: 'blue' },
  'mecanistico-sin-ensayos': { label: 'Mecanístico, sin ensayos', color: 'yellow' },
  'sin-datos': { label: 'Sin datos', color: 'gray' },
};

/** Qué hace el sistema con una contraindicación cuando aplica. */
export type Severidad = 'bloquea' | 'evaluacion' | 'condicional' | 'difiere';

export const SEVERIDAD_LABELS: Record<Severidad, { label: string; color: string }> = {
  bloquea: { label: 'Bloquea', color: 'red' },
  evaluacion: { label: 'Requiere evaluación', color: 'orange' },
  condicional: { label: 'Condicional', color: 'yellow' },
  difiere: { label: 'Difiere la sesión', color: 'blue' },
};

export interface Contraindicacion {
  id: string;
  texto: string;
  severidad: Severidad;
  /** Patrón ICD-10 para evaluarla contra las Conditions del paciente. */
  icd10?: string;
  evidencia: NivelEvidencia;
  fuente?: string;
}

export interface ParametroTerapia {
  clave: string;
  etiqueta: string;
  unidad?: string;
  tipo: 'numero' | 'texto';
  min?: number;
  max?: number;
  sugerido?: number | string;
  nota?: string;
}

export interface Indicacion {
  texto: string;
  evidencia: NivelEvidencia;
}

export interface TamizajePrevio {
  texto: string;
  obligatorio: boolean;
  nota?: string;
}

export interface Seguimiento {
  texto: string;
  cuando: string;
}

/**
 * Estado de validación clínica, por terapia.
 *
 * El material publicado de BioWellness tiene hoy `class="validado"` en el body
 * y a la vez el cartel "pendiente de validación": el estado y el mensaje se
 * despegaron. Acá no puede pasar, porque `validadoPor` y `validadoEl` son
 * obligatorios cuando el estado es 'validado', y hay un test que lo verifica.
 */
export interface Validacion {
  estado: 'borrador' | 'validado';
  validadoPor?: string;
  validadoEl?: string;
}

/**
 * Objetivo por el que se indica la terapia. **Es lo que define la frecuencia y
 * la duración**, no la terapia: un corredor preparando una maratón puede ir a
 * la cámara todos los días, y el mismo equipo en un programa de longevidad va
 * dos o tres veces por semana. No hay "la serie" de HBOT; hay la serie para
 * este objetivo.
 */
export type Objetivo =
  | 'longevidad'
  | 'preparacion-deportiva'
  | 'recuperacion-deportiva'
  | 'reparacion-tisular'
  | 'energia-fatiga'
  | 'estres-sueno';

export const OBJETIVO_LABELS: Record<Objetivo, string> = {
  longevidad: 'Longevidad y rejuvenecimiento',
  'preparacion-deportiva': 'Preparación para un evento deportivo',
  'recuperacion-deportiva': 'Recuperación del esfuerzo',
  'reparacion-tisular': 'Reparación tisular',
  'energia-fatiga': 'Energía y fatiga',
  'estres-sueno': 'Estrés y sueño',
};

/**
 * Duración de un esquema. No siempre es un número de semanas: la preparación
 * para una competencia dura hasta el evento, y una rutina de recuperación no
 * tiene fin previsto.
 */
export type Duracion = { tipo: 'semanas'; semanas: number } | { tipo: 'hasta-evento' } | { tipo: 'abierta' };

export interface Esquema {
  objetivo: Objetivo;
  /** Frecuencias posibles; la más alta es la del bloque intensivo. */
  frecuenciaSemanal: number[];
  duracion: Duracion;
  nota?: string;
}

/**
 * Tope de exposición acumulada. Se cuenta a lo largo de TODAS las series, no
 * dentro de una: alguien que hace un bloque diario para una maratón y otro seis
 * meses después acumula los dos.
 */
export interface LimiteAcumulado {
  sesionesAcumuladas: number;
  severidad: 'evaluacion' | 'seguimiento';
  texto: string;
  evidencia: NivelEvidencia;
  fuente?: string;
}

export interface Terapia {
  id: string;
  nombre: string;
  nombreCompleto: string;
  ejes: Eje[];
  medicalizacion: Medicalizacion;
  validacion: Validacion;
  resumen: string;
  /**
   * Códigos del catálogo de servicios de recepción que corresponden a esta
   * terapia (`https://biowellness.ar/fhir/CodeSystem/servicio`). Una terapia
   * puede tener varios: la cámara monoplaza y la multiplaza son dos servicios
   * distintos y **la misma exposición** — el tope de 100 sesiones es de HBOT,
   * no de un equipo.
   *
   * Está incompleto a propósito. Solo figuran los códigos que recepción mostró
   * textualmente; el contador reporta los que no reconoce en vez de contar de
   * menos en silencio.
   */
  codigosServicio?: string[];
  /** Un esquema por objetivo: la frecuencia depende de para qué se indica. */
  esquemas: Esquema[];
  /** Topes de exposición acumulada, si la terapia los tiene. */
  limitesAcumulados?: LimiteAcumulado[];
  /** Para las terapias que son un circuito de varias modalidades en orden fijo. */
  modalidades?: string[];
  /** Aclaración de alcance cuando todavía no está definido a qué camino pertenece. */
  alcancePendiente?: string;
  parametros: ParametroTerapia[];
  indicaciones: Indicacion[];
  contraindicaciones: Contraindicacion[];
  tamizajePrevio: TamizajePrevio[];
  seguimiento: Seguimiento[];
}

interface CatalogoJson {
  version: string;
  terapias: Terapia[];
}

const CATALOGO = definitionsJson as unknown as CatalogoJson;

/** Todas las terapias del catálogo. */
export function todasLasTerapias(): Terapia[] {
  return CATALOGO.terapias;
}

export function versionCatalogo(): string {
  return CATALOGO.version;
}

export function terapiaPorId(id: string): Terapia | undefined {
  return CATALOGO.terapias.find((t) => t.id === id);
}

/** Terapias de un eje. Una terapia puede pertenecer a varios. */
export function terapiasPorEje(eje: Eje): Terapia[] {
  return CATALOGO.terapias.filter((t) => t.ejes.includes(eje));
}

/** Agrupa el catálogo por eje, en el orden en que lo presenta la práctica. */
export function porEje(): { eje: Eje; label: string; terapias: Terapia[] }[] {
  const orden: Eje[] = ['rejuvenecer', 'recuperar', 'reparar'];
  return orden.map((eje) => ({ eje, label: EJE_LABELS[eje], terapias: terapiasPorEje(eje) }));
}

/** Contraindicaciones de una severidad dada. */
export function contraindicacionesPorSeveridad(t: Terapia, severidad: Severidad): Contraindicacion[] {
  return t.contraindicaciones.filter((c) => c.severidad === severidad);
}

/** Terapias que sirven a un objetivo dado. */
export function terapiasPorObjetivo(objetivo: Objetivo): Terapia[] {
  return CATALOGO.terapias.filter((t) => t.esquemas.some((e) => e.objetivo === objetivo));
}

/** El esquema de una terapia para un objetivo, si lo tiene. */
export function esquemaPara(t: Terapia, objetivo: Objetivo): Esquema | undefined {
  return t.esquemas.find((e) => e.objetivo === objetivo);
}

/** Objetivos que cubre el catálogo, sin repetir. */
export function objetivosDisponibles(): Objetivo[] {
  return [...new Set(CATALOGO.terapias.flatMap((t) => t.esquemas.map((e) => e.objetivo)))];
}

/**
 * Sesiones de un esquema con una frecuencia dada.
 *
 * Devuelve undefined cuando la duración no es un número de semanas: una
 * preparación para un evento dura hasta el evento y una rutina abierta no
 * termina. Informar un total ahí sería inventarlo.
 */
export function sesionesDelEsquema(esquema: Esquema, frecuenciaSemanal: number): number | undefined {
  return esquema.duracion.tipo === 'semanas' ? esquema.duracion.semanas * frecuenciaSemanal : undefined;
}

/** Texto de la duración, para mostrar. */
export function duracionTexto(duracion: Duracion): string {
  switch (duracion.tipo) {
    case 'semanas':
      return `${duracion.semanas} semanas`;
    case 'hasta-evento':
      return 'hasta el evento';
    default:
      return 'abierta';
  }
}

/** Sistema de códigos del catálogo de servicios de recepción. */
export const SISTEMA_SERVICIO = 'https://biowellness.ar/fhir/CodeSystem/servicio';

/**
 * Índice código de servicio → id de terapia. Varios códigos pueden apuntar a la
 * misma terapia (las tres cámaras son un solo HBOT a efectos de exposición).
 */
export function indiceCodigosServicio(terapias: Terapia[] = CATALOGO.terapias): Map<string, string> {
  const idx = new Map<string, string>();
  for (const t of terapias) {
    for (const codigo of t.codigosServicio ?? []) {
      idx.set(codigo, t.id);
    }
  }
  return idx;
}

/**
 * Límites de exposición acumulada que ya se alcanzaron, del más grave al menos.
 * Se evalúa contra el total histórico del paciente, no contra la serie actual.
 */
export function limitesAlcanzados(t: Terapia, sesionesAcumuladas: number): LimiteAcumulado[] {
  return (t.limitesAcumulados ?? [])
    .filter((l) => sesionesAcumuladas >= l.sesionesAcumuladas)
    .sort((a, b) => b.sesionesAcumuladas - a.sesionesAcumuladas);
}

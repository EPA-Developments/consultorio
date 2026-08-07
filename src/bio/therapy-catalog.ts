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

export interface Terapia {
  id: string;
  nombre: string;
  nombreCompleto: string;
  ejes: Eje[];
  medicalizacion: Medicalizacion;
  validacion: Validacion;
  resumen: string;
  /** Para las terapias que son un circuito de varias modalidades en orden fijo. */
  modalidades?: string[];
  /** Aclaración de alcance cuando todavía no está definido a qué camino pertenece. */
  alcancePendiente?: string;
  parametros: ParametroTerapia[];
  serie: { semanas: number; frecuenciasSemanales: number[] };
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

/**
 * Sesiones que tiene una serie con una frecuencia dada.
 * La serie se define en semanas, no en sesiones: el total depende del ritmo.
 */
export function sesionesDeLaSerie(t: Terapia, frecuenciaSemanal: number): number {
  return t.serie.semanas * frecuenciaSemanal;
}

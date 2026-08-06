// Esquemas de titulación de los agonistas GLP-1 y GIP/GLP-1.
//
// Las dosis son las de ficha técnica. El escalonamiento NO es un trámite: la
// dosis inicial no es terapéutica, existe para que el aparato digestivo se
// adapte, y subir antes de tiempo es la causa más común de abandono por
// náuseas. Por eso cada escalón lleva su duración mínima.
//
// Se nombra el principio activo (DCI) y la presentación por su indicación, no
// por marca comercial: la misma molécula tiene presentaciones distintas para
// diabetes y para obesidad, con topes de dosis distintos.
//
// Puro y determinístico. No decide por el médico: expone el esquema y los
// ajustes que corresponden a ESE paciente.
import type { Flag, GLP1Inputs } from './eligibility';
import { UMBRALES } from './eligibility';

/** Indicación por la que se prescribe: cambia el tope de dosis y el escalonamiento. */
export type Indication = 'dm2' | 'obesidad';

export const INDICATION_LABELS: Record<Indication, string> = {
  dm2: 'Diabetes tipo 2',
  obesidad: 'Obesidad / sobrepeso con comorbilidad',
};

/** Vía y frecuencia de administración. */
export type Presentation = 'sc-semanal' | 'sc-diaria' | 'oral-diaria';

export const PRESENTATION_LABELS: Record<Presentation, string> = {
  'sc-semanal': 'Subcutánea, 1 vez por semana',
  'sc-diaria': 'Subcutánea, 1 vez por día',
  'oral-diaria': 'Oral, 1 vez por día',
};

export interface TitrationStep {
  /** Número de escalón, empezando en 1. */
  step: number;
  dose: string;
  /** Duración mínima del escalón antes de subir. */
  weeks: number;
  /**
   * Si la dosis ya es terapéutica. Las de arranque existen para tolerancia:
   * juzgar la respuesta ahí lleva a abandonar un tratamiento que todavía no
   * empezó a actuar.
   */
  therapeutic: boolean;
  note?: string;
}

export interface TitrationSchedule {
  molecule: string;
  indication: Indication;
  presentation: Presentation;
  steps: TitrationStep[];
  /** Dosis máxima autorizada para esta indicación. */
  maxDose: string;
  notes: string[];
  source: string;
}

const ESCALONAMIENTO_LENTO =
  'Si aparecen náuseas o vómitos, sostener el escalón actual más tiempo en vez de suspender. Subir recién con buena tolerancia.';

/**
 * Esquemas por molécula e indicación. La clave es `molécula|indicación`, con la
 * molécula en la misma forma que devuelve `suggestMolecules`.
 */
const ESQUEMAS: TitrationSchedule[] = [
  {
    molecule: 'Semaglutida',
    indication: 'dm2',
    presentation: 'sc-semanal',
    steps: [
      { step: 1, dose: '0,25 mg', weeks: 4, therapeutic: false, note: 'Dosis de inicio: es para tolerancia, no trata.' },
      { step: 2, dose: '0,5 mg', weeks: 4, therapeutic: true },
      { step: 3, dose: '1 mg', weeks: 4, therapeutic: true, note: 'Dosis de mantenimiento habitual.' },
      { step: 4, dose: '2 mg', weeks: 4, therapeutic: true, note: 'Solo si hace falta más control glucémico.' },
    ],
    maxDose: '2 mg por semana',
    notes: [ESCALONAMIENTO_LENTO, 'Se aplica el mismo día de la semana, con o sin comida.'],
    source: 'Ficha técnica de semaglutida subcutánea, presentación para diabetes tipo 2.',
  },
  {
    molecule: 'Semaglutida',
    indication: 'obesidad',
    presentation: 'sc-semanal',
    steps: [
      { step: 1, dose: '0,25 mg', weeks: 4, therapeutic: false, note: 'Dosis de inicio: es para tolerancia, no trata.' },
      { step: 2, dose: '0,5 mg', weeks: 4, therapeutic: false },
      { step: 3, dose: '1 mg', weeks: 4, therapeutic: true },
      { step: 4, dose: '1,7 mg', weeks: 4, therapeutic: true },
      { step: 5, dose: '2,4 mg', weeks: 4, therapeutic: true, note: 'Dosis de mantenimiento de la indicación.' },
    ],
    maxDose: '2,4 mg por semana',
    notes: [
      ESCALONAMIENTO_LENTO,
      'Si no se tolera 2,4 mg, se puede sostener 1,7 mg como dosis de mantenimiento.',
      'Se aplica el mismo día de la semana, con o sin comida.',
    ],
    source: 'Ficha técnica de semaglutida subcutánea, presentación para control de peso.',
  },
  {
    molecule: 'Semaglutida oral',
    indication: 'dm2',
    presentation: 'oral-diaria',
    steps: [
      { step: 1, dose: '3 mg', weeks: 4, therapeutic: false, note: 'Dosis de inicio: es para tolerancia, no trata.' },
      { step: 2, dose: '7 mg', weeks: 4, therapeutic: true },
      { step: 3, dose: '14 mg', weeks: 4, therapeutic: true, note: 'Dosis máxima de la presentación oral.' },
    ],
    maxDose: '14 mg por día',
    notes: [
      ESCALONAMIENTO_LENTO,
      'En ayunas, con un sorbo de agua (hasta 120 mL). Esperar al menos 30 minutos antes de comer, beber otra cosa o tomar otros medicamentos: si no, no se absorbe.',
    ],
    source: 'Ficha técnica de semaglutida oral.',
  },
  {
    molecule: 'Tirzepatida',
    indication: 'dm2',
    presentation: 'sc-semanal',
    steps: [
      { step: 1, dose: '2,5 mg', weeks: 4, therapeutic: false, note: 'Dosis de inicio: es para tolerancia, no trata.' },
      { step: 2, dose: '5 mg', weeks: 4, therapeutic: true },
      { step: 3, dose: '7,5 mg', weeks: 4, therapeutic: true },
      { step: 4, dose: '10 mg', weeks: 4, therapeutic: true },
      { step: 5, dose: '12,5 mg', weeks: 4, therapeutic: true },
      { step: 6, dose: '15 mg', weeks: 4, therapeutic: true },
    ],
    maxDose: '15 mg por semana',
    notes: [
      ESCALONAMIENTO_LENTO,
      'Los aumentos son de 2,5 mg y nunca antes de 4 semanas en la dosis previa.',
      'Se puede sostener cualquier escalón como mantenimiento si ya alcanza el objetivo.',
    ],
    source: 'Ficha técnica de tirzepatida.',
  },
  {
    molecule: 'Tirzepatida',
    indication: 'obesidad',
    presentation: 'sc-semanal',
    steps: [
      { step: 1, dose: '2,5 mg', weeks: 4, therapeutic: false, note: 'Dosis de inicio: es para tolerancia, no trata.' },
      { step: 2, dose: '5 mg', weeks: 4, therapeutic: true },
      { step: 3, dose: '7,5 mg', weeks: 4, therapeutic: true },
      { step: 4, dose: '10 mg', weeks: 4, therapeutic: true },
      { step: 5, dose: '12,5 mg', weeks: 4, therapeutic: true },
      { step: 6, dose: '15 mg', weeks: 4, therapeutic: true },
    ],
    maxDose: '15 mg por semana',
    notes: [
      ESCALONAMIENTO_LENTO,
      'Los aumentos son de 2,5 mg y nunca antes de 4 semanas en la dosis previa.',
      'Las dosis de mantenimiento habituales son 5, 10 y 15 mg.',
    ],
    source: 'Ficha técnica de tirzepatida, indicación de control de peso.',
  },
  {
    molecule: 'Liraglutida',
    indication: 'dm2',
    presentation: 'sc-diaria',
    steps: [
      { step: 1, dose: '0,6 mg', weeks: 1, therapeutic: false, note: 'Dosis de inicio: es para tolerancia, no trata.' },
      { step: 2, dose: '1,2 mg', weeks: 1, therapeutic: true },
      { step: 3, dose: '1,8 mg', weeks: 1, therapeutic: true, note: 'Solo si hace falta más control glucémico.' },
    ],
    maxDose: '1,8 mg por día',
    notes: [ESCALONAMIENTO_LENTO, 'A la misma hora todos los días, con o sin comida.'],
    source: 'Ficha técnica de liraglutida, presentación para diabetes tipo 2.',
  },
  {
    molecule: 'Liraglutida',
    indication: 'obesidad',
    presentation: 'sc-diaria',
    steps: [
      { step: 1, dose: '0,6 mg', weeks: 1, therapeutic: false, note: 'Dosis de inicio: es para tolerancia, no trata.' },
      { step: 2, dose: '1,2 mg', weeks: 1, therapeutic: false },
      { step: 3, dose: '1,8 mg', weeks: 1, therapeutic: false },
      { step: 4, dose: '2,4 mg', weeks: 1, therapeutic: true },
      { step: 5, dose: '3 mg', weeks: 1, therapeutic: true, note: 'Dosis de mantenimiento de la indicación.' },
    ],
    maxDose: '3 mg por día',
    notes: [
      ESCALONAMIENTO_LENTO,
      'Si no se tolera un escalón, se puede demorar el aumento una semana más. Si tampoco se tolera 3 mg, se suspende: la indicación no contempla mantenimiento por debajo de esa dosis.',
    ],
    source: 'Ficha técnica de liraglutida, presentación para control de peso.',
  },
  {
    molecule: 'Dulaglutida',
    indication: 'dm2',
    presentation: 'sc-semanal',
    steps: [
      { step: 1, dose: '0,75 mg', weeks: 4, therapeutic: true, note: 'Ya es dosis terapéutica.' },
      { step: 2, dose: '1,5 mg', weeks: 4, therapeutic: true, note: 'Dosis de mantenimiento habitual.' },
      { step: 3, dose: '3 mg', weeks: 4, therapeutic: true },
      { step: 4, dose: '4,5 mg', weeks: 4, therapeutic: true },
    ],
    maxDose: '4,5 mg por semana',
    notes: [ESCALONAMIENTO_LENTO, 'Se aplica el mismo día de la semana, con o sin comida.'],
    source: 'Ficha técnica de dulaglutida.',
  },
];

/** Moléculas que tienen esquema cargado para una indicación dada. */
export function moleculesFor(indication: Indication): string[] {
  return [...new Set(ESQUEMAS.filter((e) => e.indication === indication).map((e) => e.molecule))];
}

/** Esquema de titulación de una molécula para una indicación, si existe. */
export function titrationFor(molecule: string, indication: Indication): TitrationSchedule | undefined {
  return ESQUEMAS.find((e) => e.molecule === molecule && e.indication === indication);
}

/**
 * Indicación que corresponde al perfil: si hay diabetes, el esquema es el de
 * DM2; si no, el de obesidad. Determina el tope de dosis, así que no da igual.
 */
export function indicationFor(i: GLP1Inputs): Indication {
  const hba1cDiabetica = (i.hba1cPercent ?? 0) >= UMBRALES.hba1cDiabetes;
  return i.hasT2D || hba1cDiabetica ? 'dm2' : 'obesidad';
}

/** Semana en la que se alcanza el primer escalón terapéutico. */
export function weeksToTherapeuticDose(schedule: TitrationSchedule): number {
  let semanas = 0;
  for (const step of schedule.steps) {
    if (step.therapeutic) {
      return semanas;
    }
    semanas += step.weeks;
  }
  return semanas;
}

/** Semana en la que se alcanza la dosis máxima, si se escala sin pausas. */
export function weeksToMaxDose(schedule: TitrationSchedule): number {
  return schedule.steps.slice(0, -1).reduce((n, s) => n + s.weeks, 0);
}

/**
 * Ajustes de otros fármacos al iniciar. El importante es el de insulina y
 * sulfonilureas: el GLP-1 no causa hipoglucemia por sí solo, pero sí cuando se
 * suma a un secretagogo o a insulina sin bajar la dosis previa.
 */
export function concomitantAdjustments(i: GLP1Inputs): Flag[] {
  const out: Flag[] = [];
  if (i.onInsulin) {
    out.push({
      text: 'Insulina: reducir la dosis basal al iniciar (habitualmente 20 %) y controlar glucemias los primeros días. Reevaluar en cada escalón.',
      source: 'Recomendación de ficha técnica para uso concomitante.',
    });
  }
  if (i.onSulfonylurea) {
    out.push({
      text: 'Sulfonilurea: reducir la dosis a la mitad al iniciar, o suspenderla si la HbA1c ya está cerca del objetivo.',
      source: 'Recomendación de ficha técnica para uso concomitante.',
    });
  }
  if (i.onGLP1) {
    out.push({
      text: 'Ya recibe un agonista GLP-1: no se suman dos. Si se cambia de molécula, se arranca por el escalón inicial de la nueva, no por la dosis equivalente.',
    });
  }
  return out;
}

/**
 * Qué vigilar durante el tratamiento, según el perfil del paciente. Se separa
 * de las precauciones de elegibilidad porque acá el paciente YA está tratado:
 * son cosas para chequear en cada control, no para decidir si tratar.
 */
export function safetyWatch(i: GLP1Inputs, indication: Indication): Flag[] {
  const out: Flag[] = [];

  out.push({
    text: 'Digestivo: náuseas, vómitos y constipación son lo más frecuente y suelen ceder. Porciones chicas, poca grasa, comer despacio. Si hay vómitos sostenidos, no subir la dosis.',
  });
  out.push({
    text: 'Dolor abdominal intenso y persistente, sobre todo si irradia a la espalda: suspender y descartar pancreatitis.',
  });

  if (i.hasGallbladderDisease || indication === 'obesidad') {
    out.push({
      text: 'Vesícula: el descenso rápido de peso favorece la litiasis. Consultar ante dolor en hipocondrio derecho, sobre todo posprandial.',
    });
  }
  if (i.onInsulin || i.onSulfonylurea) {
    out.push({
      text: 'Hipoglucemia: automonitoreo los primeros días de cada escalón mientras siga con insulina o sulfonilurea.',
    });
  }
  if (i.hasRetinopathy) {
    out.push({
      text: 'Retinopatía: control oftalmológico antes de iniciar y a los 3 meses. La caída rápida de la HbA1c puede empeorarla transitoriamente.',
      source: 'Señal observada en SUSTAIN-6.',
    });
  }
  if ((i.ageYears ?? 0) >= 60) {
    out.push({
      text: 'Masa magra: objetivo proteico de 1,2 a 1,6 g/kg/día y entrenamiento de fuerza 2 o 3 veces por semana desde la primera semana, no después.',
    });
  }
  if (i.sex === 'female' && (i.ageYears ?? 99) < 50) {
    out.push({
      text: 'Embarazo: suspender ante un embarazo y planificar la suspensión con al menos 2 meses de anticipación si se busca uno, por la vida media larga.',
      source: 'Ficha técnica: contraindicado en embarazo.',
    });
  }
  if (i.egfr !== undefined && i.egfr < 30) {
    out.push({
      text: 'eGFR <30: los vómitos o la diarrea pueden deshidratar y precipitar injuria renal aguda. Reforzar hidratación y consultar temprano.',
    });
  }
  return out;
}

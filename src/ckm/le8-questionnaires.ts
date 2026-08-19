// Etapa C de LE8: intérpretes de los QuestionnaireResponse que cargan los
// pacientes (sueño/PSQI, dieta/MEPA, actividad física/Exercise Vital Sign,
// tabaco) y los crosswalks a los componentes conductuales de Life's Essential 8.
//
// El profesional NO ve el formulario en blanco; este módulo solo INTERPRETA las
// respuestas. Es puro y testeable: el scoring trabaja sobre estructuras simples
// y los interpretX() extraen esas estructuras de un QuestionnaireResponse por
// linkId (mismo enfoque que el bot SDOH). Los Questionnaire FHIR canónicos y su
// carga viven en la Etapa C2; los linkId de acá son el contrato que esos
// recursos deben respetar.
import type {
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
} from '@medplum/fhirtypes';
import type { DietLevel, LE8Inputs, NicotineInput } from './le8';

// URLs canónicas (base histórica, congelada). Una versión por instrumento.
export const LE8_SLEEP_QUESTIONNAIRE_URL = 'https://bio.medplum.com.ar/fhir/Questionnaire/le8-sleep-psqi-v1';
export const LE8_DIET_QUESTIONNAIRE_URL = 'https://bio.medplum.com.ar/fhir/Questionnaire/le8-diet-mepa-v1';
export const LE8_ACTIVITY_QUESTIONNAIRE_URL = 'https://bio.medplum.com.ar/fhir/Questionnaire/le8-activity-evs-v1';
export const LE8_TOBACCO_QUESTIONNAIRE_URL = 'https://bio.medplum.com.ar/fhir/Questionnaire/le8-tobacco-v1';

// ───────────────────────────────────────────────────────────────────────────
// Acceso a respuestas por linkId.
// ───────────────────────────────────────────────────────────────────────────

/** Aplana un QuestionnaireResponse a linkId -> answers (recorre grupos anidados). */
export function answersByLinkId(response: QuestionnaireResponse): Map<string, QuestionnaireResponseItemAnswer[]> {
  const map = new Map<string, QuestionnaireResponseItemAnswer[]>();
  const walk = (items: QuestionnaireResponseItem[] | undefined): void => {
    for (const item of items ?? []) {
      if (item.answer?.length) {
        map.set(item.linkId, item.answer);
      }
      walk(item.item);
    }
  };
  walk(response.item);
  return map;
}

type Answers = Map<string, QuestionnaireResponseItemAnswer[]>;

function first(answers: Answers, linkId: string): QuestionnaireResponseItemAnswer | undefined {
  return answers.get(linkId)?.[0];
}

function numberAt(answers: Answers, linkId: string): number | undefined {
  const a = first(answers, linkId);
  if (!a) {
    return undefined;
  }
  const n = a.valueInteger ?? a.valueDecimal;
  if (typeof n === 'number' && Number.isFinite(n)) {
    return n;
  }
  // Ítems choice cuyo code es el valor numérico (ej. PSQI: code "0".."3" con
  // display en español). Se parsea el code; los codes no numéricos (ej. el
  // status de tabaco) caen a undefined y se leen con codeAt.
  const code = a.valueCoding?.code;
  if (code !== undefined && code.trim() !== '') {
    const parsed = Number(code);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function boolAt(answers: Answers, linkId: string): boolean | undefined {
  return first(answers, linkId)?.valueBoolean;
}

function codeAt(answers: Answers, linkId: string): string | undefined {
  return first(answers, linkId)?.valueCoding?.code;
}

/** Hora "HH:MM[:SS]" → minutos desde medianoche. */
function timeToMinutes(answers: Answers, linkId: string): number | undefined {
  const t = first(answers, linkId)?.valueTime;
  if (!t) {
    return undefined;
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) {
    return undefined;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) {
    return undefined;
  }
  return h * 60 + min;
}

// ───────────────────────────────────────────────────────────────────────────
// PSQI (Pittsburgh Sleep Quality Index): 19 ítems autoevaluados → 7 componentes
// (0–3 c/u) → índice global 0–21 (mayor = peor calidad). El puntaje LE8 de
// sueño NO usa el global: usa las HORAS reales de sueño (ítem 4) por la tabla de
// duración. Acá se calculan ambos: las horas (para LE8) y el global (dato
// clínico). Scoring estándar de Buysse et al. 1989.
// ───────────────────────────────────────────────────────────────────────────

export const PSQI_LINK = {
  bedtime: 'psqi-1-bedtime',
  latencyMin: 'psqi-2-latency-min',
  waketime: 'psqi-3-waketime',
  hours: 'psqi-4-hours',
  // 5a..5j: frecuencia de alteraciones del sueño (0–3). 5a alimenta la latencia.
  disturbance: ['psqi-5a', 'psqi-5b', 'psqi-5c', 'psqi-5d', 'psqi-5e', 'psqi-5f', 'psqi-5g', 'psqi-5h', 'psqi-5i', 'psqi-5j'],
  quality: 'psqi-6-quality',
  medication: 'psqi-7-medication',
  stayingAwake: 'psqi-8-staying-awake',
  enthusiasm: 'psqi-9-enthusiasm',
} as const;

export interface PsqiAnswers {
  bedtimeMinutes?: number;
  waketimeMinutes?: number;
  latencyMinutes?: number;
  hoursSlept?: number;
  /** 5a..5j (0–3). Índice 0 = 5a. */
  disturbances?: (number | undefined)[];
  quality?: number;
  medication?: number;
  stayingAwake?: number;
  enthusiasm?: number;
}

export interface PsqiResult {
  /** Índice global 0–21; solo si los 7 componentes son calculables. */
  global?: number;
  /** Los 7 componentes (0–3), undefined si falta su insumo. */
  components: {
    quality?: number;
    latency?: number;
    duration?: number;
    efficiency?: number;
    disturbances?: number;
    medication?: number;
    daytime?: number;
  };
}

/** Mapea una suma 0–6 a un componente 0–3 (latencia y disfunción diurna). */
function band6(sum: number): number {
  if (sum === 0) {
    return 0;
  }
  if (sum <= 2) {
    return 1;
  }
  if (sum <= 4) {
    return 2;
  }
  return 3;
}

export function scorePsqi(a: PsqiAnswers): PsqiResult {
  // C1 calidad subjetiva = ítem 6.
  const quality = a.quality;

  // C2 latencia = subscore de minutos + 5a, sumados (0–6) y bandeados.
  let latency: number | undefined;
  if (a.latencyMinutes !== undefined && a.disturbances?.[0] !== undefined) {
    const m = a.latencyMinutes;
    const sub = m <= 15 ? 0 : m <= 30 ? 1 : m <= 60 ? 2 : 3;
    latency = band6(sub + a.disturbances[0]);
  }

  // C3 duración = horas reales: >7=0, 6–7=1, 5–6=2, <5=3.
  let duration: number | undefined;
  if (a.hoursSlept !== undefined) {
    const h = a.hoursSlept;
    duration = h > 7 ? 0 : h >= 6 ? 1 : h >= 5 ? 2 : 3;
  }

  // C4 eficiencia = horas dormidas / horas en cama ×100.
  let efficiency: number | undefined;
  if (a.hoursSlept !== undefined && a.bedtimeMinutes !== undefined && a.waketimeMinutes !== undefined) {
    const inBed = ((a.waketimeMinutes - a.bedtimeMinutes + 1440) % 1440) / 60;
    if (inBed > 0) {
      const eff = (a.hoursSlept / inBed) * 100;
      efficiency = eff >= 85 ? 0 : eff >= 75 ? 1 : eff >= 65 ? 2 : 3;
    }
  }

  // C5 alteraciones = suma 5b..5j (0–27), bandeada. Faltantes cuentan 0.
  const distSum = (a.disturbances ?? []).slice(1, 10).reduce<number>((s, v) => s + (v ?? 0), 0);
  const disturbances = distSum === 0 ? 0 : distSum <= 9 ? 1 : distSum <= 18 ? 2 : 3;

  // C6 uso de medicación para dormir = ítem 7.
  const medication = a.medication;

  // C7 disfunción diurna = (ítem 8 + ítem 9), bandeada (0–6).
  let daytime: number | undefined;
  if (a.stayingAwake !== undefined && a.enthusiasm !== undefined) {
    daytime = band6(a.stayingAwake + a.enthusiasm);
  }

  const components = { quality, latency, duration, efficiency, disturbances, medication, daytime };
  const all = [quality, latency, duration, efficiency, disturbances, medication, daytime];
  const global = all.every((c) => c !== undefined) ? all.reduce((s, c) => s + (c as number), 0) : undefined;

  return { global, components };
}

export function extractPsqiAnswers(response: QuestionnaireResponse): PsqiAnswers {
  const ans = answersByLinkId(response);
  return {
    bedtimeMinutes: timeToMinutes(ans, PSQI_LINK.bedtime),
    waketimeMinutes: timeToMinutes(ans, PSQI_LINK.waketime),
    latencyMinutes: numberAt(ans, PSQI_LINK.latencyMin),
    hoursSlept: numberAt(ans, PSQI_LINK.hours),
    disturbances: PSQI_LINK.disturbance.map((id) => numberAt(ans, id)),
    quality: numberAt(ans, PSQI_LINK.quality),
    medication: numberAt(ans, PSQI_LINK.medication),
    stayingAwake: numberAt(ans, PSQI_LINK.stayingAwake),
    enthusiasm: numberAt(ans, PSQI_LINK.enthusiasm),
  };
}

export interface SleepInterpretation {
  /** Horas de sueño para el puntaje LE8 (tabla por duración). */
  sleepHoursPerNight?: number;
  /** PSQI completo (global + componentes), como dato clínico. */
  psqi: PsqiResult;
}

export function interpretSleep(response: QuestionnaireResponse): SleepInterpretation {
  const answers = extractPsqiAnswers(response);
  return { sleepHoursPerNight: answers.hoursSlept, psqi: scorePsqi(answers) };
}

// ───────────────────────────────────────────────────────────────────────────
// Dieta — MEPA (Mediterranean Eating Pattern for Americans), 16 ítems binarios.
// Cada ítem se redacta de modo que la respuesta favorable (mediterránea) sea
// valueBoolean=true → 1 punto; el puntaje MEPA es la cuenta de favorables (0–16)
// y se mapea a los 5 niveles LE8 de dieta.
//
// PROVISIONAL: el crosswalk exacto MEPA→nivel del advisory está en su material
// suplementario; estos cortes por quintiles son una aproximación marcada para
// calibrar con el equipo médico (misma convención que los umbrales provisionales
// de risk.ts).
// ───────────────────────────────────────────────────────────────────────────

export const MEPA_LINK = Array.from({ length: 16 }, (_, i) => `mepa-${i + 1}`);
export const MEPA_CROSSWALK_PROVISIONAL = true;

/** Puntaje MEPA 0–16 → nivel de dieta LE8 (1–5). */
export function mepaLevel(score: number): DietLevel {
  if (score <= 3) {
    return 1;
  }
  if (score <= 6) {
    return 2;
  }
  if (score <= 9) {
    return 3;
  }
  if (score <= 12) {
    return 4;
  }
  return 5;
}

export interface DietInterpretation {
  diet?: { level: DietLevel };
  /** Puntaje MEPA crudo 0–16 (dato para mostrar). */
  mepaScore?: number;
}

export function interpretDiet(response: QuestionnaireResponse): DietInterpretation {
  const ans = answersByLinkId(response);
  let answered = false;
  let score = 0;
  for (const id of MEPA_LINK) {
    const v = boolAt(ans, id);
    if (v !== undefined) {
      answered = true;
      if (v) {
        score += 1;
      }
    }
  }
  if (!answered) {
    return {};
  }
  return { diet: { level: mepaLevel(score) }, mepaScore: score };
}

// ───────────────────────────────────────────────────────────────────────────
// Actividad física — Exercise Vital Sign (2 ítems): días/semana de actividad
// moderada-vigorosa × minutos por día = minutos/semana.
// ───────────────────────────────────────────────────────────────────────────

export const EVS_LINK = { days: 'evs-days', minutesPerDay: 'evs-minutes' } as const;

export function interpretActivity(response: QuestionnaireResponse): { physicalActivityMinPerWeek?: number } {
  const ans = answersByLinkId(response);
  const days = numberAt(ans, EVS_LINK.days);
  const minutes = numberAt(ans, EVS_LINK.minutesPerDay);
  if (days === undefined || minutes === undefined) {
    return {};
  }
  return { physicalActivityMinPerWeek: Math.max(0, days) * Math.max(0, minutes) };
}

// ───────────────────────────────────────────────────────────────────────────
// Tabaco / nicotina.
// ───────────────────────────────────────────────────────────────────────────

export const TOBACCO_LINK = {
  status: 'tobacco-status', // coding: never | former | current
  quitYears: 'tobacco-quit-years',
  inhaledOnly: 'tobacco-inhaled-only',
  secondhand: 'tobacco-secondhand',
} as const;

export function interpretTobacco(response: QuestionnaireResponse): { nicotine?: NicotineInput } {
  const ans = answersByLinkId(response);
  const status = codeAt(ans, TOBACCO_LINK.status);
  if (status !== 'never' && status !== 'former' && status !== 'current') {
    return {};
  }
  return {
    nicotine: {
      status,
      yearsSinceQuit: numberAt(ans, TOBACCO_LINK.quitYears),
      inhaledNicotineOnly: boolAt(ans, TOBACCO_LINK.inhaledOnly),
      secondhandAtHome: boolAt(ans, TOBACCO_LINK.secondhand),
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Combinación: toma los QuestionnaireResponse del paciente y arma los
// componentes conductuales de LE8 + los datos clínicos de display (PSQI, MEPA).
// ───────────────────────────────────────────────────────────────────────────

export type BehavioralLE8Inputs = Pick<
  LE8Inputs,
  'diet' | 'physicalActivityMinPerWeek' | 'nicotine' | 'sleepHoursPerNight'
>;

export interface LE8QuestionnaireData {
  inputs: BehavioralLE8Inputs;
  /** PSQI completo de la respuesta de sueño más reciente, si hay. */
  psqi?: PsqiResult;
  /** Puntaje MEPA crudo, si hay respuesta de dieta. */
  mepaScore?: number;
}

/** Devuelve la respuesta más reciente (por authored) de cada cuestionario. */
function latestByQuestionnaire(responses: QuestionnaireResponse[], url: string): QuestionnaireResponse | undefined {
  return responses
    .filter((r) => r.questionnaire === url && r.status !== 'entered-in-error')
    .sort((a, b) => (b.authored ?? '').localeCompare(a.authored ?? ''))[0];
}

export function interpretLE8Questionnaires(responses: QuestionnaireResponse[]): LE8QuestionnaireData {
  const inputs: BehavioralLE8Inputs = {};
  const result: LE8QuestionnaireData = { inputs };

  const sleep = latestByQuestionnaire(responses, LE8_SLEEP_QUESTIONNAIRE_URL);
  if (sleep) {
    const { sleepHoursPerNight, psqi } = interpretSleep(sleep);
    if (sleepHoursPerNight !== undefined) {
      inputs.sleepHoursPerNight = sleepHoursPerNight;
    }
    result.psqi = psqi;
  }

  const diet = latestByQuestionnaire(responses, LE8_DIET_QUESTIONNAIRE_URL);
  if (diet) {
    const { diet: dietInput, mepaScore } = interpretDiet(diet);
    if (dietInput) {
      inputs.diet = dietInput;
    }
    result.mepaScore = mepaScore;
  }

  const activity = latestByQuestionnaire(responses, LE8_ACTIVITY_QUESTIONNAIRE_URL);
  if (activity) {
    const { physicalActivityMinPerWeek } = interpretActivity(activity);
    if (physicalActivityMinPerWeek !== undefined) {
      inputs.physicalActivityMinPerWeek = physicalActivityMinPerWeek;
    }
  }

  const tobacco = latestByQuestionnaire(responses, LE8_TOBACCO_QUESTIONNAIRE_URL);
  if (tobacco) {
    const { nicotine } = interpretTobacco(tobacco);
    if (nicotine) {
      inputs.nicotine = nicotine;
    }
  }

  return result;
}

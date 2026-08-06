// Seguimiento longitudinal de la respuesta al GLP-1 (Opción C).
//
// Mide contra el BASAL DEL PLAN, no contra el valor más viejo que haya en la
// historia clínica. Un paciente que bajó 8 kg el año pasado y volvió a subir
// tiene un histórico engañoso: lo que importa acá es qué pasó desde que empezó
// el tratamiento.
//
// Y no emite veredicto antes de la fecha de revisión. Es la misma regla del
// protocolo: si se juzga la respuesta mientras todavía se está escalando la
// dosis, la conclusión es que no funciona un tratamiento que no empezó.
//
// Puro: recibe series ya cargadas y devuelve la lectura. Sin Medplum ni UI.

/** Un valor con su fecha, de más viejo a más nuevo. */
export interface DatedValue {
  date: string;
  value: number;
  unit?: string;
}

export type ResponseMetricId = 'peso' | 'imc' | 'cintura' | 'hba1c';

export const METRIC_LABELS: Record<ResponseMetricId, string> = {
  peso: 'Peso',
  imc: 'IMC',
  cintura: 'Cintura',
  hba1c: 'HbA1c',
};

/** Para cada métrica, si conviene que baje o que suba. Todas estas bajan. */
const MEJORA_BAJANDO: Record<ResponseMetricId, boolean> = {
  peso: true,
  imc: true,
  cintura: true,
  hba1c: true,
};

export interface MetricResponse {
  id: ResponseMetricId;
  label: string;
  unit?: string;
  /** Serie completa, de más vieja a más nueva. */
  points: DatedValue[];
  /** Medición de referencia: la más cercana al inicio del plan, sin pasarse. */
  baseline?: DatedValue;
  latest?: DatedValue;
  absoluteChange?: number;
  percentChange?: number;
  /** true si el cambio va en la dirección deseada. */
  improving?: boolean;
}

/** Umbral de respuesta ponderal: 5 % del peso basal. */
export const UMBRAL_RESPUESTA_PORCENTUAL = 5;

export type ResponseVerdict = 'sin-datos' | 'sin-basal' | 'en-curso' | 'responde' | 'no-responde';

export interface ResponseAssessment {
  metrics: MetricResponse[];
  /** Pérdida ponderal en % (positiva = bajó). Sale de peso, o de IMC si no hay peso. */
  weightLossPercent?: number;
  /** De dónde salió la pérdida ponderal, para poder decirlo en pantalla. */
  weightLossSource?: 'peso' | 'imc';
  reviewDate: string;
  reviewReached: boolean;
  /** Semanas que faltan para la revisión; 0 si ya pasó. */
  weeksToReview: number;
  verdict: ResponseVerdict;
  message: string;
}

/** Ordena de más viejo a más nuevo y descarta lo que no tenga fecha o valor. */
export function normalizeSeries(points: (DatedValue | { value: number; unit?: string; date?: string })[]): DatedValue[] {
  return points
    .filter((p): p is DatedValue => typeof p.date === 'string' && Number.isFinite(p.value))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Basal del plan: la última medición HASTA la fecha de inicio. Si no hay
 * ninguna previa, se toma la primera posterior —es lo mejor disponible, aunque
 * ya incluya algo de tratamiento—.
 */
export function baselineFor(points: DatedValue[], planStartIso: string): DatedValue | undefined {
  const previas = points.filter((p) => p.date <= planStartIso);
  return previas.length > 0 ? previas[previas.length - 1] : points[0];
}

/** Arma la lectura de una métrica contra el basal del plan. */
export function metricResponse(
  id: ResponseMetricId,
  points: DatedValue[],
  planStartIso: string
): MetricResponse {
  const serie = normalizeSeries(points);
  const baseline = baselineFor(serie, planStartIso);
  const latest = serie[serie.length - 1];
  const base: MetricResponse = {
    id,
    label: METRIC_LABELS[id],
    unit: latest?.unit ?? baseline?.unit,
    points: serie,
    baseline,
    latest,
  };

  // Con una sola medición no hay cambio que reportar: el basal y el último
  // serían el mismo punto y un 0 % daría a entender que se midió dos veces.
  if (!baseline || !latest || baseline === latest || baseline.value === 0) {
    return base;
  }

  const absoluteChange = latest.value - baseline.value;
  const percentChange = (absoluteChange / baseline.value) * 100;
  return {
    ...base,
    absoluteChange,
    percentChange,
    improving: MEJORA_BAJANDO[id] ? absoluteChange < 0 : absoluteChange > 0,
  };
}

export interface ResponseInputs {
  /** Series por métrica. Puede faltar cualquiera. */
  series: Partial<Record<ResponseMetricId, DatedValue[]>>;
  /** Inicio del plan (CarePlan.period.start). */
  planStartIso: string;
  /** Semana de revisión que fijó el protocolo. */
  reviewWeeks: number;
  /** "Hoy", inyectado para que la función sea determinística. */
  nowIso: string;
}

const MS_POR_SEMANA = 7 * 24 * 3600 * 1000;

/**
 * Evalúa la respuesta. El veredicto tiene cuatro estados posibles y ninguno es
 * "no responde" antes de tiempo:
 * - sin-datos:   no hay mediciones suficientes.
 * - sin-basal:   hay mediciones, pero ninguna previa al inicio del plan.
 * - en-curso:    todavía no llegó la fecha de revisión.
 * - responde / no-responde: recién a partir de esa fecha.
 */
export function assessResponse(i: ResponseInputs): ResponseAssessment {
  const metrics = (Object.keys(METRIC_LABELS) as ResponseMetricId[])
    .map((id) => metricResponse(id, i.series[id] ?? [], i.planStartIso))
    .filter((m) => m.points.length > 0);

  const reviewDate = new Date(new Date(i.planStartIso).getTime() + i.reviewWeeks * MS_POR_SEMANA).toISOString();
  const reviewReached = i.nowIso >= reviewDate;
  const weeksToReview = reviewReached
    ? 0
    : Math.ceil((new Date(reviewDate).getTime() - new Date(i.nowIso).getTime()) / MS_POR_SEMANA);

  // El criterio es de peso. El % de cambio del IMC equivale al del peso cuando
  // la talla no cambia, así que sirve de reemplazo si no se registró el peso.
  const peso = metrics.find((m) => m.id === 'peso');
  const imc = metrics.find((m) => m.id === 'imc');
  const fuente = peso?.percentChange !== undefined ? peso : imc?.percentChange !== undefined ? imc : undefined;
  const weightLossPercent = fuente?.percentChange !== undefined ? -fuente.percentChange : undefined;

  const base = {
    metrics,
    weightLossPercent,
    weightLossSource: fuente?.id as 'peso' | 'imc' | undefined,
    reviewDate,
    reviewReached,
    weeksToReview,
  };

  if (weightLossPercent === undefined) {
    const hayAlgo = metrics.some((m) => m.points.length > 0);
    return {
      ...base,
      verdict: hayAlgo ? 'sin-basal' : 'sin-datos',
      message: hayAlgo
        ? 'Falta una medición de peso o IMC posterior al basal para poder comparar.'
        : 'Todavía no hay mediciones cargadas para seguir la respuesta.',
    };
  }

  const cumple = weightLossPercent >= UMBRAL_RESPUESTA_PORCENTUAL;
  const cifra = `${weightLossPercent.toFixed(1)} %`;

  if (!reviewReached) {
    return {
      ...base,
      verdict: 'en-curso',
      message: cumple
        ? `Ya bajó ${cifra} del peso basal, por encima del objetivo, y todavía faltan ${weeksToReview} semanas para la revisión.`
        : `Lleva ${cifra} de cambio sobre el peso basal. Faltan ${weeksToReview} semanas para la revisión: todavía es pronto para juzgar la respuesta.`,
    };
  }

  return {
    ...base,
    verdict: cumple ? 'responde' : 'no-responde',
    message: cumple
      ? `Bajó ${cifra} del peso basal, por encima del ${UMBRAL_RESPUESTA_PORCENTUAL} % esperado.`
      : `Bajó ${cifra} del peso basal, por debajo del ${UMBRAL_RESPUESTA_PORCENTUAL} % esperado. Conviene revisar antes de concluir que no responde.`,
  };
}

export const VERDICT_LABELS: Record<ResponseVerdict, { label: string; color: string }> = {
  'sin-datos': { label: 'Sin datos', color: 'gray' },
  'sin-basal': { label: 'Falta comparación', color: 'gray' },
  'en-curso': { label: 'En curso', color: 'blue' },
  responde: { label: 'Responde', color: 'teal' },
  'no-responde': { label: 'Sin respuesta suficiente', color: 'orange' },
};

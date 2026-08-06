// Lectura de un plan GLP-1 ya guardado, para poder graficar contra sus fechas.
//
// Las fechas salen de `activity.detail.scheduledPeriod`, que es dato
// estructurado. Las notas del plan también dicen la semana de revisión, pero
// son prosa: parsearlas funcionaría hasta que alguien cambie una palabra.
import type { CarePlan } from '@medplum/fhirtypes';
import { GLP1_CAREPLAN_CATEGORY } from './careplan';

/** Actividad que marca la revisión de respuesta dentro del plan. */
const REVISION = /revisión de respuesta/i;

export interface PlanTimeline {
  planStartIso: string;
  /** Fecha de la revisión de respuesta, si el plan la tiene. */
  reviewDateIso?: string;
  /** Semanas entre el inicio y la revisión. */
  reviewWeeks?: number;
  /** Controles previstos, con una etiqueta corta para el gráfico. */
  markers: { date: string; label: string }[];
  /** Molécula, tal como quedó en el título del plan. */
  molecule?: string;
}

const MS_POR_SEMANA = 7 * 24 * 3600 * 1000;

/** Los planes GLP-1 entre todos los del paciente. */
export function isGLP1CarePlan(plan: CarePlan): boolean {
  return (plan.category ?? []).some((c) => c.text === GLP1_CAREPLAN_CATEGORY.text);
}

/**
 * El plan vigente: el más reciente que no esté completado ni revocado. Un plan
 * viejo de un tratamiento anterior no debe pisar al actual.
 */
export function activeGLP1Plan(plans: CarePlan[]): CarePlan | undefined {
  return plans
    .filter(isGLP1CarePlan)
    .filter((p) => p.status !== 'completed' && p.status !== 'revoked' && p.status !== 'entered-in-error')
    .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''))[0];
}

/** Etiqueta corta para el eje del gráfico: "Semana 20", "Basal". */
function shortLabel(text: string): string {
  const conSemana = /semana\s+(\d+)/i.exec(text);
  if (conSemana) {
    return `S${conSemana[1]}`;
  }
  return /basal/i.test(text) ? 'Basal' : text.slice(0, 10);
}

export function planTimeline(plan: CarePlan): PlanTimeline | undefined {
  const planStartIso = plan.period?.start;
  if (!planStartIso) {
    return undefined;
  }

  const conFecha = (plan.activity ?? [])
    .map((a) => a.detail)
    .filter((d) => d?.scheduledPeriod?.start)
    .map((d) => ({ date: d?.scheduledPeriod?.start as string, text: d?.code?.text ?? '' }));

  const revision = conFecha.find((a) => REVISION.test(a.text));
  const reviewDateIso = revision?.date;

  return {
    planStartIso,
    reviewDateIso,
    reviewWeeks: reviewDateIso
      ? Math.round((new Date(reviewDateIso).getTime() - new Date(planStartIso).getTime()) / MS_POR_SEMANA)
      : undefined,
    markers: conFecha.map((a) => ({ date: a.date, label: shortLabel(a.text) })),
    // El título es "Protocolo GLP-1 — <molécula>".
    molecule: plan.title?.split('—')[1]?.trim(),
  };
}

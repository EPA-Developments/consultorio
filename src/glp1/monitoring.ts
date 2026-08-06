// Calendario de monitoreo de un tratamiento con GLP-1.
//
// Dos cosas distintas conviven acá y conviene no mezclarlas:
// - Los controles de SEGURIDAD, que existen para detectar daño.
// - Los de RESPUESTA, que existen para decidir si el tratamiento sirve.
//
// Los segundos tienen una trampa: si se evalúa la respuesta antes de llegar a
// dosis terapéutica, la conclusión es que "no funciona" cuando en realidad
// todavía no empezó. Por eso la revisión de respuesta se calcula a partir del
// esquema de titulación y no con un número fijo.
//
// Los estudios se nombran con el slug del catálogo de biomarcadores, así el
// pedido se puede armar después desde el recetario sin traducir nada.
import type { GLP1Inputs } from './eligibility';
import type { Indication, TitrationSchedule } from './titration';
import { weeksToTherapeuticDose } from './titration';

/** Un control programado, contado en semanas desde el inicio. */
export interface MonitoringVisit {
  weeks: number;
  label: string;
  purpose: string;
  /** Qué mirar en consulta (clínico y antropométrico). */
  checks: string[];
  /** Slugs del catálogo de biomarcadores a solicitar. */
  labs: string[];
}

/** Estudios de base, antes de la primera aplicación. */
const LABS_BASALES = [
  'hba1c',
  'glucosa-en-ayunas',
  'insulina-en-ayunas',
  'homa-ir',
  'colesterol-total',
  'hdl-colesterol',
  'ldl-colesterol',
  'trigliceridos',
  'creatinina',
  'egfr-tfg-estimada',
  'ast-got',
  'alt-tgp',
];

const LABS_CONTROL = ['hba1c', 'glucosa-en-ayunas', 'creatinina', 'egfr-tfg-estimada'];

const LABS_SEMESTRAL = [
  'hba1c',
  'glucosa-en-ayunas',
  'insulina-en-ayunas',
  'homa-ir',
  'colesterol-total',
  'hdl-colesterol',
  'ldl-colesterol',
  'trigliceridos',
  'creatinina',
  'egfr-tfg-estimada',
];

const ANTROPOMETRIA = ['Peso e IMC', 'Circunferencia de cintura', 'Presión arterial', 'Frecuencia cardíaca'];

/**
 * Arma el calendario. La visita de revisión de respuesta se ubica 12 semanas
 * DESPUÉS de alcanzar la dosis terapéutica, no 12 semanas después de iniciar.
 */
export function monitoringPlan(i: GLP1Inputs, schedule: TitrationSchedule): MonitoringVisit[] {
  const conDiabetes = schedule.indication === 'dm2';
  const semanasHastaTerapeutica = weeksToTherapeuticDose(schedule);
  const semanaRevision = semanasHastaTerapeutica + 12;

  const basal: MonitoringVisit = {
    weeks: 0,
    label: 'Basal',
    purpose: 'Dejar registrado el punto de partida. Sin esto no hay forma de decir después si el tratamiento sirvió.',
    checks: [
      ...ANTROPOMETRIA,
      'Composición corporal si está disponible (masa magra, no solo peso)',
      'Repaso de antecedentes: pancreatitis, vesícula, tiroides, embarazo',
      'Enseñar técnica de aplicación y qué esperar los primeros días',
    ],
    labs: LABS_BASALES,
  };

  const primerControl: MonitoringVisit = {
    weeks: 4,
    label: 'Semana 4',
    purpose: 'Tolerancia y adherencia. Es la visita que decide si se sube la dosis o se sostiene el escalón.',
    checks: [
      'Tolerancia digestiva (náuseas, vómitos, constipación)',
      'Peso y presión arterial',
      'Técnica de aplicación y adherencia real',
      'Ingesta proteica y actividad de fuerza',
    ],
    labs: [],
  };

  const segundoControl: MonitoringVisit = {
    weeks: 12,
    label: 'Semana 12',
    purpose: 'Primer balance objetivo, con el tratamiento ya en marcha.',
    checks: [...ANTROPOMETRIA, 'Porcentaje de peso perdido respecto del basal', 'Tolerancia y efectos adversos'],
    labs: conDiabetes ? ['hba1c', 'glucosa-en-ayunas'] : [],
  };

  const revision: MonitoringVisit = {
    weeks: semanaRevision,
    label: `Semana ${semanaRevision} · revisión de respuesta`,
    purpose: `Decisión de continuar. Cae 12 semanas después de llegar a dosis terapéutica (semana ${semanasHastaTerapeutica}), que es cuando el resultado ya es interpretable.`,
    checks: [
      ...ANTROPOMETRIA,
      'Porcentaje de peso perdido respecto del basal',
      'Composición corporal si está disponible',
      'Revisar si la dosis alcanzada es la máxima tolerada',
    ],
    labs: LABS_CONTROL,
  };

  const semestral: MonitoringVisit = {
    weeks: 26,
    label: 'Semana 26',
    purpose: 'Control completo: eficacia metabólica y seguridad renal y hepática.',
    checks: [...ANTROPOMETRIA, 'Composición corporal', 'Reevaluar estadio CKM'],
    labs: LABS_SEMESTRAL,
  };

  const plan = [basal, primerControl, segundoControl, revision, semestral];

  if (i.hasRetinopathy) {
    plan.push({
      weeks: 12,
      label: 'Semana 12 · oftalmología',
      purpose: 'Control de retinopatía por la corrección glucémica rápida.',
      checks: ['Fondo de ojo'],
      labs: [],
    });
  }
  if ((i.uacrMgG ?? 0) > 0 || (i.egfr ?? 999) < 60) {
    plan.push({
      weeks: 26,
      label: 'Semana 26 · función renal',
      purpose: 'Seguimiento de la albuminuria en enfermedad renal.',
      checks: ['Relación albúmina/creatinina en orina (UACR)'],
      labs: ['creatinina', 'egfr-tfg-estimada'],
    });
  }

  // Ordenado por semana, y las que caen en la misma semana quedan juntas.
  return plan.sort((a, b) => a.weeks - b.weeks);
}

/**
 * Qué revisar antes de dar por fallida la respuesta. No depende de la molécula
 * ni de la indicación: la causa más frecuente de "no responde" es que nunca se
 * llegó a dosis terapéutica o que no se está aplicando bien.
 */
export const REVISION_ANTES_DE_CONCLUIR = [
  '¿Llegó a la dosis terapéutica, o quedó frenado en un escalón por intolerancia?',
  '¿La aplicación es correcta y no hay salteos? (en la presentación oral, el ayuno y los 30 minutos son condición de absorción)',
  '¿Hay algo que empuje en contra: corticoides, antipsicóticos, hipotiroidismo sin tratar?',
  '¿El plan alimentario y la actividad de fuerza están sostenidos?',
  'Recién después: considerar cambio de molécula.',
] as const;

export interface ResponseReview {
  /** Semana en la que se evalúa. */
  weeks: number;
  criterion: string;
  /** Qué revisar ANTES de concluir que no responde. */
  ifNotMet: string[];
}

/**
 * Criterio de respuesta. El umbral del 5 % es el de ficha técnica para decidir
 * continuidad; lo que se agrega es el orden de revisión antes de abandonar,
 * porque la causa más frecuente de "no responde" es que nunca se llegó a dosis
 * terapéutica o que no se está aplicando bien.
 */
export function responseReview(schedule: TitrationSchedule): ResponseReview {
  const semanas = weeksToTherapeuticDose(schedule) + 12;
  return {
    weeks: semanas,
    criterion:
      'Descenso de al menos 5 % del peso basal. Con menos, revisar antes de concluir que el tratamiento no sirve.',
    ifNotMet: [...REVISION_ANTES_DE_CONCLUIR],
  };
}

/** Los estudios de una visita, sin repetir, para armar el pedido de laboratorio. */
export function labsForVisit(plan: MonitoringVisit[], weeks: number): string[] {
  return [...new Set(plan.filter((v) => v.weeks === weeks).flatMap((v) => v.labs))];
}

/** Indicación textual, para encabezar el protocolo. */
export function indicationSummary(indication: Indication, molecule: string): string {
  return indication === 'dm2'
    ? `${molecule} con esquema de diabetes tipo 2`
    : `${molecule} con esquema de control de peso`;
}

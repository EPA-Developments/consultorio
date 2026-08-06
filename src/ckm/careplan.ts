// Plan Bienestar 100 días (CarePlan IA) — módulo puro y testeable.
//
// Define la forma del plan estructurado que genera el LLM (Claude), el esquema
// de la "tool" que fuerza esa estructura, el armado del prompt a partir del
// contexto CKM del paciente, y la conversión del plan a recursos FHIR
// (CarePlan + Goal + Task). Sin dependencias de red ni del cliente Medplum: la
// llamada al LLM y la persistencia las hace el bot.
//
// GUARDARRAÍL: el CarePlan se crea SIEMPRE como 'draft' y debe ser revisado y
// aprobado por el médico antes de pasar a 'active'. El contenido del LLM es
// apoyo educativo, no una prescripción.
import type { CarePlan, CarePlanActivity, Goal, Reference, Task } from '@medplum/fhirtypes';
import type { CKMStage, HGraphMetric, PREVENTScores } from './types';
import { CKM_STAGES } from './constants';

/** Marca de recurso generado por IA (para que la UI lo señale). */
export const AI_GENERATED_TAG = {
  system: 'https://seguimiento.medplum.com.ar/fhir/tags',
  code: 'ai-generated',
  display: 'Generado por IA (borrador)',
};

export const CAREPLAN_DURATION_DAYS = 100;

export type ActividadCategoria = 'alimentacion' | 'actividad_fisica' | 'control_clinico' | 'habitos' | 'medicacion';

/** Plan estructurado que devuelve el LLM (vía la tool crear_plan_bienestar). */
export interface CarePlanProposal {
  resumen: string;
  objetivos: { descripcion: string; metrica?: string; valorObjetivo?: string; plazoDias?: number }[];
  actividades: {
    categoria: ActividadCategoria;
    titulo: string;
    descripcion: string;
    frecuencia?: string;
    diaInicio?: number;
    diaFin?: number;
  }[];
  controles: { titulo: string; descripcion?: string; diaProgramado: number }[];
  planAlimentario?: { descripcion: string; ejemplos?: string[] };
  planCaminata?: { descripcion: string; etapas?: string[] };
}

/** Definición de la tool de Claude que fuerza la estructura del plan. */
export const CAREPLAN_TOOL = {
  name: 'crear_plan_bienestar',
  description:
    'Registra un Plan Bienestar de 100 días estructurado para un paciente con riesgo cardio-reno-metabólico (CKM). ' +
    'Los días se cuentan desde el inicio del plan (día 0).',
  input_schema: {
    type: 'object',
    properties: {
      resumen: { type: 'string', description: 'Resumen del plan, en español claro y empático para el paciente.' },
      objetivos: {
        type: 'array',
        description: 'Metas medibles (ej. bajar presión, perder peso, dejar de fumar).',
        items: {
          type: 'object',
          properties: {
            descripcion: { type: 'string' },
            metrica: { type: 'string', description: 'Parámetro a seguir (ej. "Presión sistólica").' },
            valorObjetivo: { type: 'string', description: 'Valor objetivo (ej. "< 130 mmHg").' },
            plazoDias: { type: 'integer', description: 'Días hasta evaluar la meta.' },
          },
          required: ['descripcion'],
        },
      },
      actividades: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            categoria: {
              type: 'string',
              enum: ['alimentacion', 'actividad_fisica', 'control_clinico', 'habitos', 'medicacion'],
            },
            titulo: { type: 'string' },
            descripcion: { type: 'string' },
            frecuencia: { type: 'string', description: 'Ej. "diaria", "3 veces por semana".' },
            diaInicio: { type: 'integer' },
            diaFin: { type: 'integer' },
          },
          required: ['categoria', 'titulo', 'descripcion'],
        },
      },
      controles: {
        type: 'array',
        description: 'Controles clínicos / turnos a agendar, con el día del plan en que se programan.',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string' },
            descripcion: { type: 'string' },
            diaProgramado: { type: 'integer' },
          },
          required: ['titulo', 'diaProgramado'],
        },
      },
      planAlimentario: {
        type: 'object',
        description: 'Plan de comidas DASH/mediterráneo con ingredientes de Argentina.',
        properties: {
          descripcion: { type: 'string' },
          ejemplos: { type: 'array', items: { type: 'string' }, description: 'Comidas/recetas de ejemplo.' },
        },
        required: ['descripcion'],
      },
      planCaminata: {
        type: 'object',
        description: 'Plan de caminata progresivo adaptado al estadío CKM.',
        properties: {
          descripcion: { type: 'string' },
          etapas: { type: 'array', items: { type: 'string' } },
        },
        required: ['descripcion'],
      },
    },
    required: ['resumen', 'objetivos', 'actividades', 'controles'],
  },
} as const;

export interface CarePlanContext {
  stage?: CKMStage;
  ageYears?: number;
  sex?: string;
  metrics?: HGraphMetric[];
  prevent?: PREVENTScores;
  conditions?: string[];
  medications?: string[];
  sdohScore?: number;
}

/** Arma los mensajes (system + user) para el LLM a partir del contexto CKM. */
export function buildCarePlanMessages(ctx: CarePlanContext): { system: string; user: string } {
  const system =
    'Sos un asistente clínico que ayuda a un cardiólogo en Argentina a redactar el BORRADOR de un ' +
    `"Plan Bienestar de ${CAREPLAN_DURATION_DAYS} días" para un paciente con riesgo cardio-reno-metabólico (CKM), ` +
    'según la guía AHA/ACC/ADA/ASN 2026.\n\n' +
    'Pautas:\n' +
    '- Plan alimentario tipo DASH/mediterráneo adaptado a ingredientes y comidas habituales de Argentina.\n' +
    '- Plan de caminata/actividad física progresivo y seguro, adaptado al estadío CKM del paciente.\n' +
    '- Objetivos medibles y controles clínicos con fechas relativas (día del plan).\n' +
    '- NO prescribas dosis ni cambies medicación: podés sugerir adherencia, hábitos y controles.\n' +
    '- Es un BORRADOR de apoyo: el médico lo revisa y aprueba. No reemplaza el juicio clínico.\n' +
    '- Escribí en español rioplatense, claro y empático.\n' +
    'Devolvé el plan completo usando la herramienta crear_plan_bienestar.';

  const lines: string[] = ['Datos del paciente (anonimizados):'];
  if (ctx.stage !== undefined) {
    lines.push(`- Estadío CKM: ${ctx.stage} (${CKM_STAGES[ctx.stage]?.label ?? ''}).`);
  }
  if (ctx.ageYears) {
    lines.push(`- Edad: ${ctx.ageYears} años.`);
  }
  if (ctx.sex) {
    lines.push(`- Sexo: ${ctx.sex}.`);
  }
  if (ctx.prevent) {
    lines.push(
      `- Riesgo PREVENT: ASCVD 10a ${ctx.prevent.ascvd10y}%, IC 10a ${ctx.prevent.hf10y}%, ` +
        `ECV total 30a ${ctx.prevent.cvdTotal30y}%.`
    );
  }
  if (ctx.metrics?.length) {
    const m = ctx.metrics
      .map((x) => `${x.label} ${x.value}${x.unit ? ' ' + x.unit : ''} (${x.status})`)
      .join('; ');
    lines.push(`- Últimas mediciones: ${m}.`);
  }
  if (ctx.conditions?.length) {
    lines.push(`- Diagnósticos: ${ctx.conditions.join('; ')}.`);
  }
  if (ctx.medications?.length) {
    lines.push(`- Medicación actual: ${ctx.medications.join('; ')}.`);
  }
  if (ctx.sdohScore !== undefined) {
    lines.push(`- Score de determinantes sociales (SDOH): ${ctx.sdohScore} (mayor = más vulnerabilidad).`);
  }
  lines.push(`\nGenerá un Plan Bienestar de ${CAREPLAN_DURATION_DAYS} días para este paciente.`);

  return { system, user: lines.join('\n') };
}

/** Suma días a una fecha ISO. Aritmética en UTC, independiente de la zona horaria del runtime. */
export function addDays(startIso: string, days: number): string {
  return new Date(new Date(startIso).getTime() + days * 24 * 3600 * 1000).toISOString();
}

/** Convierte los objetivos del plan en recursos Goal (propuestos). */
export function proposalToGoals(proposal: CarePlanProposal, patientId: string, startIso: string): Goal[] {
  return proposal.objetivos.map((o) => {
    const goal: Goal = {
      resourceType: 'Goal',
      lifecycleStatus: 'proposed',
      description: { text: o.descripcion },
      subject: { reference: `Patient/${patientId}` },
      startDate: startIso.slice(0, 10),
    };
    if (o.metrica || o.valorObjetivo) {
      goal.target = [
        {
          measure: o.metrica ? { text: o.metrica } : undefined,
          detailString: o.valorObjetivo,
          dueDate: o.plazoDias ? addDays(startIso, o.plazoDias).slice(0, 10) : undefined,
        },
      ];
    }
    return goal;
  });
}

/** Convierte los controles del plan en Task (a agendar). */
export function proposalToTasks(proposal: CarePlanProposal, patientId: string, startIso: string): Task[] {
  return proposal.controles.map((c) => ({
    resourceType: 'Task',
    status: 'requested',
    intent: 'plan',
    priority: 'routine',
    code: { text: c.titulo },
    description: c.descripcion,
    for: { reference: `Patient/${patientId}` },
    authoredOn: startIso,
    executionPeriod: { start: addDays(startIso, c.diaProgramado) },
  }));
}

const CATEGORIA_LABEL: Record<ActividadCategoria, string> = {
  alimentacion: 'Alimentación',
  actividad_fisica: 'Actividad física',
  control_clinico: 'Control clínico',
  habitos: 'Hábitos',
  medicacion: 'Medicación / adherencia',
};

function activity(title: string, description: string, scheduled?: string): CarePlanActivity {
  return {
    detail: {
      status: 'not-started',
      code: { text: title },
      description: scheduled ? `${description} (${scheduled})` : description,
    },
  };
}

/** Construye el CarePlan (borrador) que referencia los Goals creados. */
export function proposalToCarePlan(
  proposal: CarePlanProposal,
  patientId: string,
  goalRefs: Reference<Goal>[],
  startIso: string
): CarePlan {
  const activities: CarePlanActivity[] = proposal.actividades.map((a) =>
    activity(`[${CATEGORIA_LABEL[a.categoria]}] ${a.titulo}`, a.descripcion, a.frecuencia)
  );
  if (proposal.planAlimentario) {
    const ej = proposal.planAlimentario.ejemplos?.length
      ? ` Ejemplos: ${proposal.planAlimentario.ejemplos.join('; ')}.`
      : '';
    activities.push(activity('Plan alimentario (DASH/mediterráneo, Argentina)', proposal.planAlimentario.descripcion + ej));
  }
  if (proposal.planCaminata) {
    const et = proposal.planCaminata.etapas?.length ? ` Etapas: ${proposal.planCaminata.etapas.join('; ')}.` : '';
    activities.push(activity('Plan de caminata progresivo', proposal.planCaminata.descripcion + et));
  }

  return {
    resourceType: 'CarePlan',
    status: 'draft',
    intent: 'plan',
    meta: { tag: [AI_GENERATED_TAG] },
    title: `Plan Bienestar ${CAREPLAN_DURATION_DAYS} días (borrador IA)`,
    description: proposal.resumen,
    subject: { reference: `Patient/${patientId}` },
    category: [{ text: 'Cardio-Reno-Metabólico (CKM)' }],
    period: { start: startIso, end: addDays(startIso, CAREPLAN_DURATION_DAYS) },
    created: startIso,
    goal: goalRefs,
    activity: activities,
    note: [
      {
        text:
          'Borrador generado por IA (Claude) como apoyo. Debe ser revisado y aprobado por el médico antes de ' +
          'activarse. No reemplaza el juicio clínico ni constituye una prescripción.',
      },
    ],
  };
}

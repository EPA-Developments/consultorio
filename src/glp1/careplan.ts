// Vuelca el protocolo GLP-1 a recursos FHIR: un CarePlan con el esquema y una
// Task por cada control del calendario.
//
// Las Task son lo que cierra el circuito. Con status 'requested' aparecen en el
// tablero del médico y en la ficha del paciente, así que el control de la
// semana 20 deja de vivir solamente en la cabeza de quien lo indicó.
//
// Se generan Task y no Appointment a propósito: un Appointment es un turno con
// hora y participantes, y agendar cinco turnos con horarios inventados
// ensuciaría la agenda. Una Task con fecha prevista es exactamente "esto hay
// que hacerlo alrededor de esta fecha", que es lo que el protocolo sabe.
//
// El plan nace en 'draft': lo activa el médico, no el sistema.
import type { CarePlan, CarePlanActivity, Task } from '@medplum/fhirtypes';
import { addDays } from '../ckm/careplan';
import { PROTOCOL_PROVISIONAL_NOTE, PROTOCOL_VERIFIED } from './eligibility';
import type { MonitoringVisit } from './monitoring';
import type { GLP1Protocol } from './protocol';
import { INDICATION_LABELS, PRESENTATION_LABELS } from './titration';

/** Categoría con la que se reconocen estos planes entre los del paciente. */
export const GLP1_CAREPLAN_CATEGORY = { text: 'Protocolo GLP-1 (CKM)' };

const DIAS_POR_SEMANA = 7;

/** Fecha prevista de un control, a partir de la semana del calendario. */
export function visitDate(startIso: string, weeks: number): string {
  return addDays(startIso, weeks * DIAS_POR_SEMANA);
}

function titrationActivity(protocol: GLP1Protocol): CarePlanActivity {
  const pasos = protocol.titration.steps
    .map((s) => `${s.dose} × ${s.weeks === 1 ? '1 semana' : `${s.weeks} semanas`}${s.therapeutic ? '' : ' (inicio)'}`)
    .join(' → ');
  return {
    detail: {
      status: 'not-started',
      code: { text: `Titulación de ${protocol.molecule}` },
      description:
        `${PRESENTATION_LABELS[protocol.titration.presentation]}. ${pasos}. ` +
        `Dosis máxima: ${protocol.titration.maxDose}.`,
    },
  };
}

function visitActivity(visit: MonitoringVisit, startIso: string): CarePlanActivity {
  const conEstudios = visit.labs.length > 0 ? ` Estudios: ${visit.labs.join(', ')}.` : '';
  return {
    detail: {
      status: 'not-started',
      code: { text: visit.label },
      description: visit.purpose + conEstudios,
      // La fecha prevista, para que el plan diga cuándo y no solo qué.
      scheduledPeriod: { start: visitDate(startIso, visit.weeks) },
    },
  };
}

/**
 * Construye el CarePlan. Queda en 'draft' y con el período que va del inicio al
 * último control previsto.
 */
export function glp1CarePlan(protocol: GLP1Protocol, patientId: string, startIso: string): CarePlan {
  const ultimaSemana = Math.max(...protocol.monitoring.map((v) => v.weeks), 0);

  const notas = [
    `Protocolo de ${protocol.molecule} con esquema de ${INDICATION_LABELS[protocol.indication].toLowerCase()}. ` +
      'Soporte a la decisión: la indicación, el producto y la dosis final son del profesional. ' +
      'Debe revisarse y activarse antes de considerarlo vigente.',
    ...protocol.adjustments.map((a) => `Ajuste: ${a.text}`),
    ...protocol.safety.map((s) => `Vigilar: ${s.text}`),
    `Revisión de respuesta en la semana ${protocol.response.weeks}. ${protocol.response.criterion}`,
  ];
  if (!PROTOCOL_VERIFIED) {
    notas.unshift(PROTOCOL_PROVISIONAL_NOTE);
  }

  return {
    resourceType: 'CarePlan',
    status: 'draft',
    intent: 'plan',
    title: `Protocolo GLP-1 — ${protocol.molecule}`,
    description:
      `Titulación y monitoreo de ${protocol.molecule} (${INDICATION_LABELS[protocol.indication].toLowerCase()}).`,
    subject: { reference: `Patient/${patientId}` },
    category: [GLP1_CAREPLAN_CATEGORY],
    period: { start: startIso, end: visitDate(startIso, ultimaSemana) },
    created: startIso,
    activity: [
      titrationActivity(protocol),
      ...protocol.monitoring.map((v) => visitActivity(v, startIso)),
    ],
    note: notas.map((text) => ({ text })),
  };
}

/**
 * Una Task por control. `carePlanRef` las ata al plan; en una transacción se
 * pasa el urn:uuid del CarePlan, que el servidor resuelve.
 */
export function glp1Tasks(
  protocol: GLP1Protocol,
  patientId: string,
  startIso: string,
  carePlanRef?: string
): Task[] {
  return protocol.monitoring.map((v) => {
    const detalle = [v.purpose, ...v.checks.map((c) => `· ${c}`)];
    if (v.labs.length > 0) {
      detalle.push(`· Estudios: ${v.labs.join(', ')}`);
    }
    const task: Task = {
      resourceType: 'Task',
      status: 'requested',
      intent: 'plan',
      priority: 'routine',
      code: { text: `${protocol.molecule} — ${v.label}` },
      description: detalle.join('\n'),
      for: { reference: `Patient/${patientId}` },
      authoredOn: startIso,
      executionPeriod: { start: visitDate(startIso, v.weeks) },
    };
    if (carePlanRef) {
      task.basedOn = [{ reference: carePlanRef }];
    }
    return task;
  });
}

export interface GLP1PlanResources {
  carePlan: CarePlan;
  tasks: Task[];
}

/**
 * Plan completo listo para escribir. Las Task quedan atadas al CarePlan por
 * `carePlanRef`, que en una transacción es el urn:uuid del plan.
 */
export function buildGLP1Plan(
  protocol: GLP1Protocol,
  patientId: string,
  startIso: string,
  carePlanRef?: string
): GLP1PlanResources {
  return {
    carePlan: glp1CarePlan(protocol, patientId, startIso),
    tasks: glp1Tasks(protocol, patientId, startIso, carePlanRef),
  };
}

// Núcleo del Home del médico: transforma los recursos FHIR ya cargados en
// "ítems de worklist" (una fila clickeable con título, subtítulo y badge) y
// calcula los KPIs del encabezado. Capa pura, sin UI ni I/O: fácil de testear.
import type {
  Appointment,
  CarePlan,
  DiagnosticReport,
  Encounter,
  Patient,
  QuestionnaireResponse,
  ServiceRequest,
  Task,
} from '@medplum/fhirtypes';
import type { DashboardRow } from '../ckm/dashboard';
import { groupByRequisition } from '../laborders/lab-order';

/** Una fila de un worklist del home. */
export interface WorklistItem {
  id: string;
  /** Texto principal (normalmente el paciente). */
  primary: string;
  /** Texto secundario (contexto: qué es, cuándo). */
  secondary?: string;
  /** Ruta a la que navega al hacer click. */
  href?: string;
  /** Etiqueta corta a la derecha. */
  badge?: string;
  /** Color Mantine del badge. */
  badgeColor?: string;
}

/** Umbrales de "alto riesgo" cardiovascular para el worklist de seguimiento. */
export const HIGH_ASCVD_10Y = 20; // % ASCVD 10a ≥ 20 = riesgo alto (guía ACC/AHA)
export const HIGH_CVD_30Y = 30; // % ECV total 30a ≥ 30 = riesgo alto
export const SUBCLINICAL_STAGE = 3; // estadío CKM 3–4 = ECV subclínica/clínica

/** Un paciente es "alto riesgo" por estadío CKM avanzado o PREVENT elevado. */
export function isHighRisk(row: DashboardRow): boolean {
  return (
    (row.stage !== undefined && row.stage >= SUBCLINICAL_STAGE) ||
    (row.ascvd10y !== undefined && row.ascvd10y >= HIGH_ASCVD_10Y) ||
    (row.cvdTotal30y !== undefined && row.cvdTotal30y >= HIGH_CVD_30Y)
  );
}

function fmtDate(iso: string | undefined): string {
  if (!iso) {
    return 's/fecha';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-AR');
}

function patientIdFromRef(ref: string | undefined): string | undefined {
  return ref?.match(/^Patient\/(.+)$/)?.[1];
}

// ── KPIs del encabezado ──────────────────────────────────────────────────────

export interface HomeKpis {
  total: number;
  /** Conteo por estadío CKM (0–4). */
  byStage: Record<number, number>;
  highRisk: number;
  withAlerts: number;
}

export function computeKpis(rows: DashboardRow[]): HomeKpis {
  const byStage: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  let highRisk = 0;
  let withAlerts = 0;
  for (const row of rows) {
    if (row.stage !== undefined) {
      byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    }
    if (isHighRisk(row)) {
      highRisk++;
    }
    if (row.hasAlert) {
      withAlerts++;
    }
  }
  return { total: rows.length, byStage, highRisk, withAlerts };
}

// ── Worklists ────────────────────────────────────────────────────────────────

/**
 * Solicitudes de laboratorio del paciente pendientes de aprobar. Agrupa los
 * ServiceRequest (intent proposal) por requisición: una fila por solicitud.
 */
export function buildLabProposalItems(requests: ServiceRequest[]): WorklistItem[] {
  const groups = [...groupByRequisition(requests).entries()];
  return groups
    .map(([requisitionId, reqs]) => {
      const first = reqs[0];
      const patientId = patientIdFromRef(first.subject?.reference);
      return {
        id: requisitionId,
        primary: first.subject?.display ?? first.subject?.reference ?? 'Paciente',
        secondary: `${reqs.length} análisis · ${fmtDate(first.authoredOn)}`,
        href: patientId ? `/Patient/${patientId}/ordenes` : undefined,
        badge: 'Revisar',
        badgeColor: 'orange',
        _sort: first.authoredOn ?? '',
      };
    })
    .sort((a, b) => b._sort.localeCompare(a._sort))
    .map(({ _sort, ...item }) => item);
}

/** Pacientes con alertas CKM sin leer. */
export function buildAlertItems(rows: DashboardRow[]): WorklistItem[] {
  return rows
    .filter((r) => r.hasAlert)
    .map((r) => ({
      id: r.patient.id as string,
      primary: r.name || '(sin nombre)',
      secondary: 'Alerta CKM sin leer',
      href: `/Patient/${r.patient.id}`,
      badge: r.stage !== undefined ? `Estadío ${r.stage}` : undefined,
      badgeColor: 'red',
    }));
}

/** Pacientes de alto riesgo, ordenados por ASCVD 10a descendente. */
export function buildHighRiskItems(rows: DashboardRow[]): WorklistItem[] {
  return rows
    .filter(isHighRisk)
    .sort((a, b) => (b.ascvd10y ?? 0) - (a.ascvd10y ?? 0))
    .map((r) => ({
      id: r.patient.id as string,
      primary: r.name || '(sin nombre)',
      secondary: `ASCVD ${r.ascvd10y ?? '—'}% · estadío ${r.stage ?? '—'}`,
      href: `/Patient/${r.patient.id}`,
      badge: r.ascvd10y !== undefined && r.ascvd10y >= HIGH_ASCVD_10Y ? 'Alto' : undefined,
      badgeColor: 'red',
    }));
}

const ACTIVE_TASK_STATUSES = new Set(['draft', 'requested', 'received', 'accepted', 'ready', 'in-progress', 'on-hold']);

/** Tareas del médico que siguen pendientes (excluye completadas/canceladas). */
export function buildTaskItems(tasks: Task[]): WorklistItem[] {
  return tasks
    .filter((t) => !t.status || ACTIVE_TASK_STATUSES.has(t.status))
    .map((t) => ({
      id: t.id as string,
      primary: t.code?.text ?? t.description ?? 'Tarea',
      secondary: t.for?.display ?? undefined,
      href: patientIdFromRef(t.for?.reference) ? `/Patient/${patientIdFromRef(t.for?.reference)}` : `/Task/${t.id}`,
      badge: t.priority && t.priority !== 'routine' ? t.priority : undefined,
      badgeColor: 'yellow',
    }));
}

/** Planes de cuidado en borrador esperando aprobación médica. */
export function buildCarePlanItems(carePlans: CarePlan[]): WorklistItem[] {
  return carePlans.map((cp) => {
    const patientId = patientIdFromRef(cp.subject?.reference);
    return {
      id: cp.id as string,
      primary: cp.subject?.display ?? cp.subject?.reference ?? 'Paciente',
      secondary: cp.title ?? 'Plan en borrador',
      href: patientId ? `/Patient/${patientId}` : `/CarePlan/${cp.id}`,
      badge: 'Aprobar',
      badgeColor: 'violet',
    };
  });
}

/** Etiqueta amigable del cuestionario a partir de su URL canónica. */
export function questionnaireLabel(url: string | undefined): string {
  if (!url) {
    return 'Cuestionario';
  }
  const u = url.toLowerCase();
  if (u.includes('sleep') || u.includes('psqi')) {
    return 'Sueño (PSQI)';
  }
  if (u.includes('diet') || u.includes('mepa')) {
    return 'Dieta (MEPA)';
  }
  if (u.includes('activity') || u.includes('exercise')) {
    return 'Actividad física';
  }
  if (u.includes('tobacco') || u.includes('nicotine')) {
    return 'Tabaco';
  }
  if (u.includes('sdoh')) {
    return 'SDOH';
  }
  return 'Cuestionario';
}

/** URLs de cuestionarios que le interesan al médico interpretar. */
const INTERESTING_QUESTIONNAIRES = ['le8-', 'psqi', 'mepa', 'exercise', 'tobacco', 'nicotine', 'sdoh'];

function isInteresting(url: string | undefined): boolean {
  const u = (url ?? '').toLowerCase();
  return INTERESTING_QUESTIONNAIRES.some((k) => u.includes(k));
}

/**
 * Cuestionarios completados por el paciente, listos para interpretar
 * (LE8/PSQI/MEPA/actividad/tabaco/SDOH). Solo status 'completed'.
 */
export function buildQuestionnaireItems(responses: QuestionnaireResponse[]): WorklistItem[] {
  return responses
    .filter((qr) => qr.status === 'completed' && isInteresting(qr.questionnaire))
    .map((qr) => {
      const patientId = patientIdFromRef(qr.subject?.reference);
      return {
        id: qr.id as string,
        primary: qr.subject?.display ?? qr.subject?.reference ?? 'Paciente',
        secondary: `${questionnaireLabel(qr.questionnaire)} · ${fmtDate(qr.authored)}`,
        href: patientId ? `/Patient/${patientId}/le8` : `/QuestionnaireResponse/${qr.id}`,
        badge: 'Interpretar',
        badgeColor: 'teal',
      };
    });
}

/** Últimos pacientes (ya vienen ordenados por -_lastUpdated). */
export function buildRecentPatientItems(patients: Patient[], limit = 6): WorklistItem[] {
  return patients.slice(0, limit).map((p) => ({
    id: p.id as string,
    primary: patientName(p),
    secondary: p.birthDate ? `Nac. ${fmtDate(p.birthDate)}` : undefined,
    href: `/Patient/${p.id}`,
  }));
}

function patientName(p: Patient): string {
  return p.name?.[0] ? [p.name[0].given?.join(' '), p.name[0].family].filter(Boolean).join(' ') : '(sin nombre)';
}

// ── Etapa 2 ──────────────────────────────────────────────────────────────────

// Estados de Encounter que siguen "abiertos" (evolución sin cerrar/finalizar).
const OPEN_ENCOUNTER_STATUSES = new Set(['planned', 'arrived', 'triaged', 'in-progress', 'onleave']);

/** Evoluciones (Encounter) del médico que quedaron sin cerrar. */
export function buildUnfinishedEncounterItems(encounters: Encounter[]): WorklistItem[] {
  return encounters
    .filter((e) => e.status && OPEN_ENCOUNTER_STATUSES.has(e.status))
    .map((e) => ({
      id: e.id as string,
      primary: e.subject?.display ?? e.subject?.reference ?? 'Paciente',
      secondary: `Evolución ${e.status} · ${fmtDate(e.period?.start)}`,
      href: `/Encounter/${e.id}`,
      badge: 'Sin cerrar',
      badgeColor: 'yellow',
    }));
}

/** Cuestionarios que el paciente empezó pero no terminó (status in-progress). */
export function buildPendingQuestionnaireItems(responses: QuestionnaireResponse[]): WorklistItem[] {
  return responses
    .filter((qr) => qr.status === 'in-progress' && isInteresting(qr.questionnaire))
    .map((qr) => {
      const patientId = patientIdFromRef(qr.subject?.reference);
      return {
        id: qr.id as string,
        primary: qr.subject?.display ?? qr.subject?.reference ?? 'Paciente',
        secondary: `${questionnaireLabel(qr.questionnaire)} · incompleto`,
        href: patientId ? `/Patient/${patientId}` : `/QuestionnaireResponse/${qr.id}`,
        badge: 'Sin responder',
        badgeColor: 'gray',
      };
    });
}

/** Pacientes que cumplen años en el mes dado (1–12), ordenados por día. */
export function buildBirthdayItems(patients: Patient[], month: number): WorklistItem[] {
  return patients
    .filter((p) => p.birthDate && Number(p.birthDate.slice(5, 7)) === month)
    .sort((a, b) => (a.birthDate as string).slice(8, 10).localeCompare((b.birthDate as string).slice(8, 10)))
    .map((p) => {
      const bd = p.birthDate as string;
      return {
        id: p.id as string,
        primary: patientName(p),
        secondary: `Cumple ${bd.slice(8, 10)}/${bd.slice(5, 7)}`,
        href: `/Patient/${p.id}`,
        badge: '🎂',
      };
    });
}

function appointmentPatientRef(a: Appointment): { reference?: string; display?: string } | undefined {
  return a.participant?.map((p) => p.actor).find((actor) => actor?.reference?.startsWith('Patient/'));
}

/** Próximos turnos (Appointment), ordenados por horario de inicio. */
export function buildAppointmentItems(appointments: Appointment[]): WorklistItem[] {
  return appointments
    .filter((a) => a.status !== 'cancelled' && a.status !== 'entered-in-error')
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
    .map((a) => {
      const patient = appointmentPatientRef(a);
      const patientId = patientIdFromRef(patient?.reference);
      const start = a.start ? new Date(a.start) : undefined;
      const when =
        start && !Number.isNaN(start.getTime())
          ? start.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
          : 's/hora';
      return {
        id: a.id as string,
        primary: patient?.display ?? patient?.reference ?? a.description ?? 'Turno',
        secondary: when,
        href: patientId ? `/Patient/${patientId}` : `/Appointment/${a.id}`,
        badge: a.status,
        badgeColor: 'blue',
      };
    });
}

/** Resultados de laboratorio recientes para revisar (DiagnosticReport). */
export function buildResultItems(reports: DiagnosticReport[]): WorklistItem[] {
  return reports.map((r) => {
    const patientId = patientIdFromRef(r.subject?.reference);
    return {
      id: r.id as string,
      primary: r.subject?.display ?? r.subject?.reference ?? 'Paciente',
      secondary: `${r.code?.text ?? r.code?.coding?.[0]?.display ?? 'Resultado'} · ${fmtDate(r.effectiveDateTime ?? r.issued)}`,
      href: patientId ? `/Patient/${patientId}` : `/DiagnosticReport/${r.id}`,
      badge: 'Nuevo',
      badgeColor: 'blue',
    };
  });
}

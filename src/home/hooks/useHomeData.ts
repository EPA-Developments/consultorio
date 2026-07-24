// Hook del Home del médico: carga en paralelo los recursos de todos los widgets
// y los transforma con el módulo puro home-data. Ninguna búsqueda auxiliar que
// falle debe tumbar el home (cada búsqueda cae a vacío ante error). Solo lee.
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
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { useEffect, useState } from 'react';
import { loadDashboardRows } from '../../ckm/dashboard';
import type { DashboardRow } from '../../ckm/dashboard';
import { LABORATORY_CATEGORY } from '../../laborders/lab-order';
import {
  buildAlertItems,
  buildAppointmentItems,
  buildBirthdayItems,
  buildCarePlanItems,
  buildHighRiskItems,
  buildLabProposalItems,
  buildPendingQuestionnaireItems,
  buildQuestionnaireItems,
  buildRecentPatientItems,
  buildResultItems,
  buildTaskItems,
  buildUnfinishedEncounterItems,
  computeKpis,
} from '../home-data';
import type { HomeKpis, WorklistItem } from '../home-data';

export interface HomeData {
  kpis: HomeKpis;
  labProposals: WorklistItem[];
  alerts: WorklistItem[];
  highRisk: WorklistItem[];
  tasks: WorklistItem[];
  carePlans: WorklistItem[];
  questionnaires: WorklistItem[];
  recentPatients: WorklistItem[];
  // Etapa 2
  appointments: WorklistItem[];
  unfinishedEncounters: WorklistItem[];
  pendingQuestionnaires: WorklistItem[];
  results: WorklistItem[];
  birthdays: WorklistItem[];
  loading: boolean;
}

const EMPTY_KPIS: HomeKpis = { total: 0, byStage: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, highRisk: 0, withAlerts: 0 };
const LAB_CODE = LABORATORY_CATEGORY.coding?.[0]?.code as string;

async function settled<T>(p: Promise<T[]>, label: string): Promise<T[]> {
  try {
    return await p;
  } catch (err) {
    console.error(`Home: error cargando ${label}`, err);
    return [];
  }
}

const EMPTY: HomeData = {
  kpis: EMPTY_KPIS,
  labProposals: [],
  alerts: [],
  highRisk: [],
  tasks: [],
  carePlans: [],
  questionnaires: [],
  recentPatients: [],
  appointments: [],
  unfinishedEncounters: [],
  pendingQuestionnaires: [],
  results: [],
  birthdays: [],
  loading: true,
};

export function useHomeData(): HomeData {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const practitionerId = profile?.resourceType === 'Practitioner' ? profile.id : undefined;
  const [data, setData] = useState<HomeData>();

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    // Fecha actual: el hook corre en el navegador (no en un contexto sin Date).
    const todayIso = new Date().toISOString().slice(0, 10);
    const currentMonth = new Date().getMonth() + 1;
    const practitionerRef = practitionerId ? `Practitioner/${practitionerId}` : undefined;

    void (async () => {
      const [rows, proposals, tasks, carePlans, questionnaires, encounters, appointments, results, birthdayPatients] =
        await Promise.all([
          settled<DashboardRow>(loadDashboardRows(medplum), 'panel'),
          settled<ServiceRequest>(
            medplum.searchResources('ServiceRequest', {
              intent: 'proposal',
              status: 'draft',
              category: LAB_CODE,
              _sort: '-authored',
              _count: '100',
            }),
            'solicitudes de laboratorio'
          ),
          practitionerRef
            ? settled<Task>(
                medplum.searchResources('Task', { owner: practitionerRef, _sort: '-_lastUpdated', _count: '50' }),
                'tareas'
              )
            : Promise.resolve([] as Task[]),
          settled<CarePlan>(
            medplum.searchResources('CarePlan', { status: 'draft', _sort: '-_lastUpdated', _count: '50' }),
            'planes de cuidado'
          ),
          settled<QuestionnaireResponse>(
            medplum.searchResources('QuestionnaireResponse', { _sort: '-_lastUpdated', _count: '80' }),
            'cuestionarios'
          ),
          practitionerRef
            ? settled<Encounter>(
                medplum.searchResources('Encounter', {
                  participant: practitionerRef,
                  _sort: '-_lastUpdated',
                  _count: '50',
                }),
                'evoluciones'
              )
            : Promise.resolve([] as Encounter[]),
          practitionerRef
            ? settled<Appointment>(
                medplum.searchResources('Appointment', {
                  actor: practitionerRef,
                  date: `ge${todayIso}`,
                  _sort: 'date',
                  _count: '30',
                }),
                'turnos'
              )
            : Promise.resolve([] as Appointment[]),
          settled<DiagnosticReport>(
            medplum.searchResources('DiagnosticReport', { _sort: '-_lastUpdated', _count: '20' }),
            'resultados'
          ),
          settled<Patient>(medplum.searchResources('Patient', { _count: '500' }), 'cumpleaños'),
        ]);
      if (cancelled) {
        return;
      }
      setData({
        kpis: computeKpis(rows),
        labProposals: buildLabProposalItems(proposals),
        alerts: buildAlertItems(rows),
        highRisk: buildHighRiskItems(rows),
        tasks: buildTaskItems(tasks),
        carePlans: buildCarePlanItems(carePlans),
        questionnaires: buildQuestionnaireItems(questionnaires),
        recentPatients: buildRecentPatientItems(rows.map((r) => r.patient)),
        appointments: buildAppointmentItems(appointments),
        unfinishedEncounters: buildUnfinishedEncounterItems(encounters),
        pendingQuestionnaires: buildPendingQuestionnaireItems(questionnaires),
        results: buildResultItems(results),
        birthdays: buildBirthdayItems(birthdayPatients, currentMonth),
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [medplum, practitionerId]);

  return data ?? EMPTY;
}

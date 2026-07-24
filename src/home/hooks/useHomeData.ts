// Hook del Home del médico: carga en paralelo los recursos de todos los widgets
// y los transforma con el módulo puro home-data. Ninguna búsqueda auxiliar que
// falle debe tumbar el home (Promise.allSettled + fallback a vacío). Solo lee.
import type { CarePlan, QuestionnaireResponse, ServiceRequest, Task } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { useEffect, useState } from 'react';
import { loadDashboardRows } from '../../ckm/dashboard';
import type { DashboardRow } from '../../ckm/dashboard';
import { LABORATORY_CATEGORY } from '../../laborders/lab-order';
import {
  buildAlertItems,
  buildCarePlanItems,
  buildHighRiskItems,
  buildLabProposalItems,
  buildQuestionnaireItems,
  buildRecentPatientItems,
  buildTaskItems,
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

export function useHomeData(): HomeData {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const practitionerId = profile?.resourceType === 'Practitioner' ? profile.id : undefined;
  const [data, setData] = useState<HomeData>();

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    void (async () => {
      const [rows, proposals, tasks, carePlans, questionnaires] = await Promise.all([
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
        practitionerId
          ? settled<Task>(
              medplum.searchResources('Task', {
                owner: `Practitioner/${practitionerId}`,
                _sort: '-_lastUpdated',
                _count: '50',
              }),
              'tareas'
            )
          : Promise.resolve([] as Task[]),
        settled<CarePlan>(
          medplum.searchResources('CarePlan', { status: 'draft', _sort: '-_lastUpdated', _count: '50' }),
          'planes de cuidado'
        ),
        settled<QuestionnaireResponse>(
          medplum.searchResources('QuestionnaireResponse', {
            status: 'completed',
            _sort: '-_lastUpdated',
            _count: '50',
          }),
          'cuestionarios'
        ),
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
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [medplum, practitionerId]);

  return (
    data ?? {
      kpis: EMPTY_KPIS,
      labProposals: [],
      alerts: [],
      highRisk: [],
      tasks: [],
      carePlans: [],
      questionnaires: [],
      recentPatients: [],
      loading: true,
    }
  );
}

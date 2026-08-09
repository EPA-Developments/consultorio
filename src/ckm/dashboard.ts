// Carga de datos del panel CKM (/ckm): pacientes + alertas sin leer.
// Separado del componente para poder testearlo con MockClient y reusarlo.
//
// Acá había una columna "RiskAssessment" que leía un recurso que NINGÚN flujo
// de producción crea (los scores PREVENT viven como extensiones del Patient;
// RiskAssessment solo lo escribía el seed de demo). La columna mostraba "—"
// para todos los pacientes reales, para siempre. Se eliminó: una columna
// permanentemente vacía enseña a ignorar el panel.
import type { MedplumClient } from '@medplum/core';
import { formatHumanName } from '@medplum/core';
import type { HumanName, Patient } from '@medplum/fhirtypes';
import { getCKMStage, getHGraphData } from './extensions';
import type { PreventOutcome } from './risk';
import type { CKMStage } from './types';

export interface DashboardRow {
  patient: Patient;
  name: string;
  stage?: CKMStage;
  ascvd10y?: number;
  hf10y?: number;
  cvdTotal30y?: number;
  /** Score de calcio coronario (Agatston), si está entre las métricas. Reclasifica ASCVD. */
  cac?: number;
  hasAlert: boolean;
}

/** Campo por el que se ordena el panel: estadío o cualquiera de los scores PREVENT. */
export type DashboardSortField = 'stage' | PreventOutcome;

export interface DashboardSort {
  field: DashboardSortField;
  descending: boolean;
}

/**
 * Comparador puro para ordenar filas del panel (estadío o cualquier score
 * PREVENT). Las filas sin dato (undefined) van SIEMPRE al final, en ambas
 * direcciones — así "sin score" nunca se ordena como si fuera "score bajo".
 * Pensado para usarse con Array.prototype.sort.
 */
export function compareRows(sort: DashboardSort, a: DashboardRow, b: DashboardRow): number {
  const aValue = sort.field === 'stage' ? a.stage : a[sort.field];
  const bValue = sort.field === 'stage' ? b.stage : b[sort.field];
  if (aValue === undefined && bValue === undefined) {
    return 0;
  }
  if (aValue === undefined) {
    return 1;
  }
  if (bValue === undefined) {
    return -1;
  }
  return (aValue - bValue) * (sort.descending ? -1 : 1);
}

export async function loadDashboardRows(medplum: MedplumClient): Promise<DashboardRow[]> {
  // TODO: optimizar con una query GraphQL que traiga Patient + Communication
  // en una sola llamada y pagine de verdad.
  const patients = await medplum.searchResources('Patient', { _count: '50', _sort: '-_lastUpdated' });
  if (patients.length === 0) {
    return [];
  }
  const subjects = patients.map((p) => `Patient/${p.id}`).join(',');

  // Las búsquedas auxiliares no deben tumbar el panel completo si fallan:
  // se registra el error y la columna queda vacía.
  const [alertResult] = await Promise.allSettled([
    medplum.searchResources('Communication', { subject: subjects, category: 'alert', _count: '500' }),
  ]);
  if (alertResult.status === 'rejected') {
    console.error('Panel CKM: error buscando Communications de alerta', alertResult.reason);
  }
  // "Sin leer" = no completada; el filtro de status va del lado del cliente
  // para no depender del modificador :not del servidor
  const alerts = (alertResult.status === 'fulfilled' ? alertResult.value : []).filter((c) => c.status !== 'completed');
  const alertedPatients = new Set(alerts.map((a) => a.subject?.reference));

  return patients.map((patient) => {
    const hGraph = getHGraphData(patient);
    const prevent = hGraph.prevent;
    return {
      patient,
      name: patient.name ? formatHumanName(patient.name[0] as HumanName) : '',
      stage: getCKMStage(patient),
      ascvd10y: prevent?.ascvd10y,
      hf10y: prevent?.hf10y,
      cvdTotal30y: prevent?.cvdTotal30y,
      cac: hGraph.metrics?.find((m) => m.id === 'cac')?.value,
      hasAlert: alertedPatients.has(`Patient/${patient.id}`),
    };
  });
}

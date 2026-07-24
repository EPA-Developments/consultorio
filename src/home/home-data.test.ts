import type { CarePlan, Patient, QuestionnaireResponse, ServiceRequest, Task } from '@medplum/fhirtypes';
import type { DashboardRow } from '../ckm/dashboard';
import {
  buildAlertItems,
  buildCarePlanItems,
  buildHighRiskItems,
  buildLabProposalItems,
  buildQuestionnaireItems,
  buildRecentPatientItems,
  buildTaskItems,
  computeKpis,
  isHighRisk,
  questionnaireLabel,
} from './home-data';

function row(partial: Partial<DashboardRow>): DashboardRow {
  return {
    patient: { resourceType: 'Patient', id: partial.patient?.id ?? 'p' },
    name: 'Paciente',
    hasAlert: false,
    ...partial,
  };
}

describe('isHighRisk / computeKpis', () => {
  test('alto riesgo por estadío ≥3, por ASCVD ≥20 o por ECV30 ≥30', () => {
    expect(isHighRisk(row({ stage: 3 }))).toBe(true);
    expect(isHighRisk(row({ ascvd10y: 22 }))).toBe(true);
    expect(isHighRisk(row({ cvdTotal30y: 35 }))).toBe(true);
    expect(isHighRisk(row({ stage: 1, ascvd10y: 8 }))).toBe(false);
  });

  test('KPIs: total, por estadío, alto riesgo y con alertas', () => {
    const rows = [
      row({ patient: { resourceType: 'Patient', id: 'a' }, stage: 0 }),
      row({ patient: { resourceType: 'Patient', id: 'b' }, stage: 2, ascvd10y: 25 }),
      row({ patient: { resourceType: 'Patient', id: 'c' }, stage: 4, hasAlert: true }),
    ];
    const k = computeKpis(rows);
    expect(k.total).toBe(3);
    expect(k.byStage[2]).toBe(1);
    expect(k.byStage[4]).toBe(1);
    expect(k.highRisk).toBe(2); // b (ASCVD 25) + c (estadío 4)
    expect(k.withAlerts).toBe(1);
  });
});

describe('buildLabProposalItems', () => {
  function sr(reqId: string, patient: string, code: string, authored: string): ServiceRequest {
    return {
      resourceType: 'ServiceRequest',
      status: 'draft',
      intent: 'proposal',
      subject: { reference: `Patient/${patient}`, display: `Paciente ${patient}` },
      authoredOn: authored,
      requisition: { system: 's', value: reqId },
      code: { text: code },
    };
  }

  test('agrupa por requisición (una fila por solicitud) con conteo y ruta a la tab de órdenes', () => {
    const items = buildLabProposalItems([
      sr('SOL-1', 'p1', 'Glucosa', '2026-07-01T10:00:00Z'),
      sr('SOL-1', 'p1', 'Insulina', '2026-07-01T10:00:00Z'),
      sr('SOL-2', 'p2', 'TSH', '2026-07-05T10:00:00Z'),
    ]);
    expect(items).toHaveLength(2);
    const sol1 = items.find((i) => i.id === 'SOL-1');
    expect(sol1?.primary).toBe('Paciente p1');
    expect(sol1?.secondary).toContain('2 análisis');
    expect(sol1?.href).toBe('/Patient/p1/ordenes');
    expect(sol1?.badge).toBe('Revisar');
  });

  test('ordena por fecha descendente (más nueva primero)', () => {
    const items = buildLabProposalItems([
      sr('SOL-1', 'p1', 'Glucosa', '2026-07-01T10:00:00Z'),
      sr('SOL-2', 'p2', 'TSH', '2026-07-05T10:00:00Z'),
    ]);
    expect(items[0].id).toBe('SOL-2');
  });
});

describe('buildAlertItems / buildHighRiskItems', () => {
  test('alertas: solo pacientes con hasAlert', () => {
    const items = buildAlertItems([
      row({ patient: { resourceType: 'Patient', id: 'a' }, name: 'Ana', hasAlert: true, stage: 2 }),
      row({ patient: { resourceType: 'Patient', id: 'b' }, name: 'Beto', hasAlert: false }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].primary).toBe('Ana');
    expect(items[0].badge).toBe('Estadío 2');
  });

  test('alto riesgo: ordenado por ASCVD desc', () => {
    const items = buildHighRiskItems([
      row({ patient: { resourceType: 'Patient', id: 'a' }, name: 'Ana', ascvd10y: 22 }),
      row({ patient: { resourceType: 'Patient', id: 'b' }, name: 'Beto', ascvd10y: 31 }),
      row({ patient: { resourceType: 'Patient', id: 'c' }, name: 'Caro', ascvd10y: 5 }), // no es alto
    ]);
    expect(items.map((i) => i.primary)).toEqual(['Beto', 'Ana']);
  });
});

describe('buildTaskItems', () => {
  function task(status: Task['status'], text: string): Task {
    return { resourceType: 'Task', id: text, status, intent: 'order', code: { text } };
  }
  test('excluye completadas/canceladas, conserva las pendientes', () => {
    const items = buildTaskItems([
      task('requested', 'Llamar paciente'),
      task('in-progress', 'Revisar lab'),
      task('completed', 'Ya hecha'),
      task('cancelled', 'Anulada'),
    ]);
    expect(items.map((i) => i.primary)).toEqual(['Llamar paciente', 'Revisar lab']);
  });
});

describe('buildQuestionnaireItems / questionnaireLabel', () => {
  test('etiqueta por URL', () => {
    expect(questionnaireLabel('https://x/le8-sleep-v1')).toBe('Sueño (PSQI)');
    expect(questionnaireLabel('https://x/le8-diet-mepa-v1')).toBe('Dieta (MEPA)');
    expect(questionnaireLabel('https://x/ckm-sdoh-screening-v1')).toBe('SDOH');
    expect(questionnaireLabel(undefined)).toBe('Cuestionario');
  });

  test('solo completados e interesantes', () => {
    const qr = (status: QuestionnaireResponse['status'], q: string, id: string): QuestionnaireResponse => ({
      resourceType: 'QuestionnaireResponse',
      id,
      status,
      questionnaire: q,
      subject: { reference: 'Patient/p1', display: 'Ana' },
      authored: '2026-07-01T10:00:00Z',
    });
    const items = buildQuestionnaireItems([
      qr('completed', 'https://x/le8-sleep-v1', 'a'),
      qr('in-progress', 'https://x/le8-diet-v1', 'b'), // no completado
      qr('completed', 'https://x/otro-form', 'c'), // no interesante
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('a');
    expect(items[0].secondary).toContain('Sueño (PSQI)');
    expect(items[0].href).toBe('/Patient/p1/le8');
  });
});

describe('buildCarePlanItems / buildRecentPatientItems', () => {
  test('planes en borrador → fila con badge Aprobar', () => {
    const cp: CarePlan = {
      resourceType: 'CarePlan',
      id: 'cp1',
      status: 'draft',
      intent: 'plan',
      subject: { reference: 'Patient/p1', display: 'Ana' },
      title: 'Plan 100 días',
    };
    const items = buildCarePlanItems([cp]);
    expect(items[0]).toMatchObject({
      primary: 'Ana',
      secondary: 'Plan 100 días',
      href: '/Patient/p1',
      badge: 'Aprobar',
    });
  });

  test('pacientes recientes: respeta el límite y arma el nombre', () => {
    const patients: Patient[] = Array.from({ length: 8 }, (_, i) => ({
      resourceType: 'Patient',
      id: `p${i}`,
      name: [{ given: ['N'], family: `Fam${i}` }],
    }));
    const items = buildRecentPatientItems(patients, 6);
    expect(items).toHaveLength(6);
    expect(items[0].primary).toBe('N Fam0');
    expect(items[0].href).toBe('/Patient/p0');
  });
});

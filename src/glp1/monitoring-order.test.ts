import type { Bundle, ObservationDefinition } from '@medplum/fhirtypes';
import bundleJson from '../../data/ckm/biomarker-definitions.json';
import { parseObservationDefinition } from '../ckm/observation-definitions';
import { buildLabOrder, toLabOrderItems } from '../laborders/lab-order';
import type { GLP1Inputs } from './eligibility';
import { monitoringPlan } from './monitoring';
import { monitoringOrderNote, planOrderFor } from './monitoring-order';
import { titrationFor } from './titration';

/** Catálogo real de 109 biomarcadores, normalizado a ítems de orden. */
const CATALOGO = toLabOrderItems(
  ((bundleJson as unknown as Bundle).entry ?? [])
    .map((e) => e.resource as ObservationDefinition)
    .filter((r) => r?.resourceType === 'ObservationDefinition')
    .map(parseObservationDefinition)
);

function paciente(extra: Partial<GLP1Inputs> = {}): GLP1Inputs {
  return { ageYears: 52, sex: 'male', bmi: 33, waistCm: 105, hba1cPercent: 5.6, egfr: 90, ...extra };
}

const visitaBasal = (): string[] =>
  monitoringPlan(paciente(), titrationFor('Semaglutida', 'obesidad')!).find((v) => v.weeks === 0)!.labs;

describe('planOrderFor', () => {
  test('la visita basal se traduce a una orden sin estudios desconocidos', () => {
    const plan = planOrderFor(visitaBasal(), CATALOGO);
    expect(plan.unknown).toStrictEqual([]);
    expect(plan.notOrderable).toStrictEqual([]);
    expect(plan.items.length).toBeGreaterThan(0);
  });

  // HOMA-IR y eGFR no se piden por sí mismos: el laboratorio los calcula. Si se
  // mandaran tal cual, buildLabOrder los descartaría sin decir nada.
  test('los derivados se reportan como reemplazados, no como perdidos', () => {
    const plan = planOrderFor(visitaBasal(), CATALOGO);
    expect(plan.replacedDerived.sort()).toStrictEqual(['egfr-tfg-estimada', 'homa-ir']);
    expect(plan.items.some((i) => i.biomarcadorId === 'homa-ir')).toBe(false);
    expect(plan.items.some((i) => i.biomarcadorId === 'egfr-tfg-estimada')).toBe(false);
  });

  test('las fuentes de los derivados sí quedan en la orden', () => {
    const ids = planOrderFor(visitaBasal(), CATALOGO).items.map((i) => i.biomarcadorId);
    expect(ids).toContain('glucosa-en-ayunas'); // fuente de HOMA-IR
    expect(ids).toContain('insulina-en-ayunas'); // fuente de HOMA-IR
    expect(ids).toContain('creatinina'); // fuente de eGFR
  });

  // Aunque el calendario no los nombre, un derivado tiene que arrastrar su fuente.
  test('pedir solo el derivado trae igual sus fuentes', () => {
    const plan = planOrderFor(['homa-ir'], CATALOGO);
    const ids = plan.items.map((i) => i.biomarcadorId);
    expect(ids).toContain('glucosa-en-ayunas');
    expect(ids).toContain('insulina-en-ayunas');
    expect(plan.items).toHaveLength(2);
  });

  test('un slug que no existe se reporta, no se traga', () => {
    const plan = planOrderFor(['hba1c', 'marcador-inventado'], CATALOGO);
    expect(plan.unknown).toStrictEqual(['marcador-inventado']);
    expect(plan.items.map((i) => i.biomarcadorId)).toStrictEqual(['hba1c']);
  });

  test('no duplica si la fuente ya estaba pedida explícitamente', () => {
    const plan = planOrderFor(['homa-ir', 'glucosa-en-ayunas', 'insulina-en-ayunas'], CATALOGO);
    const ids = plan.items.map((i) => i.biomarcadorId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('lista vacía: orden vacía, sin errores', () => {
    expect(planOrderFor([], CATALOGO)).toMatchObject({ items: [], unknown: [], notOrderable: [] });
  });
});

describe('Circuito completo: calendario → orden → ServiceRequest', () => {
  // Esta es la prueba que importa. Todo lo anterior puede estar bien y aun así
  // perderse un análisis en el último paso, que es el que filtra por orderable.
  test('todos los estudios de todas las visitas llegan a un ServiceRequest', () => {
    const plan = monitoringPlan(
      paciente({ hasT2D: true, hba1cPercent: 8.1, egfr: 45, uacrMgG: 85, hasRetinopathy: true }),
      titrationFor('Semaglutida', 'dm2')!
    );

    for (const visita of plan) {
      if (visita.labs.length === 0) {
        continue;
      }
      const orden = planOrderFor(visita.labs, CATALOGO);
      expect(orden.unknown, visita.label).toStrictEqual([]);
      expect(orden.notOrderable, visita.label).toStrictEqual([]);

      const requests = buildLabOrder({
        subject: { reference: 'Patient/p1' },
        items: orden.items,
        requisitionId: 'ORD-TEST',
        authoredOn: '2026-08-06T12:00:00.000Z',
      });
      // Ni uno solo se cae entre planOrderFor y buildLabOrder.
      expect(requests, visita.label).toHaveLength(orden.items.length);
      expect(requests.every((r) => r.code?.text), visita.label).toBe(true);
    }
  });

  test('la orden queda agrupada por requisición y con intent de orden médica', () => {
    const orden = planOrderFor(visitaBasal(), CATALOGO);
    const requests = buildLabOrder({
      subject: { reference: 'Patient/p1' },
      items: orden.items,
      requisitionId: 'ORD-ABC123',
      authoredOn: '2026-08-06T12:00:00.000Z',
      intent: 'order',
    });
    expect(requests.every((r) => r.requisition?.value === 'ORD-ABC123')).toBe(true);
    expect(requests.every((r) => r.intent === 'order' && r.status === 'active')).toBe(true);
  });
});

describe('monitoringOrderNote', () => {
  test('deja registrada la cobertura y de qué control salió el pedido', () => {
    const nota = monitoringOrderNote('Semana 26', 'Semaglutida', 'OSDE');
    expect(nota).toContain('OSDE');
    expect(nota).toContain('Semaglutida');
    expect(nota).toContain('Semana 26');
  });
});

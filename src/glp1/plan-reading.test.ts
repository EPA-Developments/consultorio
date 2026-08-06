import type { CarePlan } from '@medplum/fhirtypes';
import { glp1CarePlan } from './careplan';
import type { GLP1Inputs } from './eligibility';
import { activeGLP1Plan, isGLP1CarePlan, planTimeline } from './plan-reading';
import { buildProtocol } from './protocol';

const INICIO = '2026-08-06T12:00:00.000Z';
const SUJETO = { reference: 'Patient/p1' };

function paciente(extra: Partial<GLP1Inputs> = {}): GLP1Inputs {
  return { ageYears: 52, sex: 'male', bmi: 33, waistCm: 105, hba1cPercent: 5.6, egfr: 90, ...extra };
}

/** Plan real, generado por el mismo código que corre en producción. */
function planReal(extra: Partial<GLP1Inputs> = {}, molecula = 'Semaglutida'): CarePlan {
  return glp1CarePlan(buildProtocol(paciente(extra), molecula)!, 'p1', INICIO);
}

describe('isGLP1CarePlan', () => {
  test('reconoce el plan por su categoría', () => {
    expect(isGLP1CarePlan(planReal())).toBe(true);
  });

  test('no confunde con el Plan Bienestar ni con planes sin categoría', () => {
    expect(
      isGLP1CarePlan({ resourceType: 'CarePlan', status: 'active', intent: 'plan', subject: SUJETO, category: [{ text: 'Otro' }] })
    ).toBe(false);
    expect(isGLP1CarePlan({ resourceType: 'CarePlan', status: 'active', intent: 'plan', subject: SUJETO })).toBe(false);
  });
});

describe('activeGLP1Plan', () => {
  const viejo = { ...planReal(), status: 'completed' as const };
  const vigente = planReal();

  test('elige el vigente y descarta el completado', () => {
    expect(activeGLP1Plan([viejo, vigente])).toBe(vigente);
  });

  test('descarta revocados y cargados por error', () => {
    expect(activeGLP1Plan([{ ...vigente, status: 'revoked' }])).toBeUndefined();
    expect(activeGLP1Plan([{ ...vigente, status: 'entered-in-error' }])).toBeUndefined();
  });

  // Un plan de un tratamiento anterior no debe pisar al actual.
  test('entre dos vigentes gana el que empezó más tarde', () => {
    const anterior = { ...planReal(), period: { start: '2025-01-01T00:00:00.000Z' } };
    expect(activeGLP1Plan([vigente, anterior])).toBe(vigente);
    expect(activeGLP1Plan([anterior, vigente])).toBe(vigente);
  });

  test('sin planes GLP-1 no devuelve nada', () => {
    expect(activeGLP1Plan([])).toBeUndefined();
    expect(activeGLP1Plan([{ resourceType: 'CarePlan', status: 'active', intent: 'plan', subject: SUJETO }])).toBeUndefined();
  });
});

describe('planTimeline', () => {
  // Las fechas salen de datos estructurados, no de parsear las notas.
  test('lee el inicio y la fecha de revisión desde las actividades', () => {
    const t = planTimeline(planReal())!;
    expect(t.planStartIso).toBe(INICIO);
    expect(t.reviewWeeks).toBe(20);
    expect(t.reviewDateIso?.slice(0, 10)).toBe('2026-12-24');
  });

  test('la semana de revisión sigue al esquema, no a una constante', () => {
    expect(planTimeline(planReal({ hasT2D: true }))!.reviewWeeks).toBe(16);
    expect(planTimeline(planReal({ hasT2D: true }, 'Dulaglutida'))!.reviewWeeks).toBe(12);
  });

  test('arma una marca por control, con etiqueta corta', () => {
    const t = planTimeline(planReal())!;
    expect(t.markers.map((m) => m.label)).toStrictEqual(['Basal', 'S4', 'S12', 'S20', 'S26']);
    expect(t.markers[0].date).toBe(INICIO);
  });

  test('saca la molécula del título', () => {
    expect(planTimeline(planReal())!.molecule).toBe('Semaglutida');
  });

  test('un plan sin período no se puede graficar', () => {
    expect(planTimeline({ resourceType: 'CarePlan', status: 'draft', intent: 'plan', subject: SUJETO })).toBeUndefined();
  });

  test('un plan sin actividad de revisión igual devuelve el inicio', () => {
    const sinRevision: CarePlan = {
      ...planReal(),
      activity: [{ detail: { status: 'not-started', code: { text: 'Basal' }, scheduledPeriod: { start: INICIO } } }],
    };
    const t = planTimeline(sinRevision)!;
    expect(t.planStartIso).toBe(INICIO);
    expect(t.reviewWeeks).toBeUndefined();
    expect(t.markers).toHaveLength(1);
  });
});

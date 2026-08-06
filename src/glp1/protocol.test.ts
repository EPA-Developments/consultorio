import bundleJson from '../../data/ckm/biomarker-definitions.json';
import type { Bundle, ObservationDefinition } from '@medplum/fhirtypes';
import type { GLP1Inputs } from './eligibility';
import { labsForVisit, monitoringPlan, responseReview } from './monitoring';
import { buildProtocol } from './protocol';
import { titrationFor, weeksToTherapeuticDose } from './titration';

function paciente(extra: Partial<GLP1Inputs> = {}): GLP1Inputs {
  return { ageYears: 52, sex: 'male', bmi: 33, waistCm: 105, hba1cPercent: 5.6, egfr: 90, ...extra };
}

/** Slugs realmente presentes en el catálogo de 109 biomarcadores. */
const SLUGS_CATALOGO = new Set(
  ((bundleJson as unknown as Bundle).entry ?? [])
    .map((e) => e.resource as ObservationDefinition)
    .flatMap((r) => r.identifier?.map((i) => i.value) ?? [])
    .filter((v): v is string => Boolean(v))
);

describe('buildProtocol', () => {
  test('arma el protocolo completo para una molécula con esquema', () => {
    const p = buildProtocol(paciente(), 'Semaglutida')!;
    expect(p.indication).toBe('obesidad');
    expect(p.titration.steps.length).toBeGreaterThan(0);
    expect(p.monitoring.length).toBeGreaterThan(0);
    expect(p.response.weeks).toBeGreaterThan(0);
  });

  test('con contraindicación absoluta no hay protocolo', () => {
    expect(buildProtocol(paciente({ hasMTCorMEN2: true }), 'Semaglutida')).toBeUndefined();
    expect(buildProtocol(paciente({ isPregnantOrPlanning: true }), 'Semaglutida')).toBeUndefined();
  });

  test('molécula sin esquema para esa indicación: no devuelve nada', () => {
    // Dulaglutida no tiene indicación de control de peso.
    expect(buildProtocol(paciente(), 'Dulaglutida')).toBeUndefined();
    expect(buildProtocol(paciente({ hasT2D: true }), 'Dulaglutida')).toBeDefined();
  });

  test('molécula inexistente no rompe', () => {
    expect(buildProtocol(paciente(), 'Retatrutida')).toBeUndefined();
  });

  test('el paciente con diabetes recibe el esquema de DM2', () => {
    expect(buildProtocol(paciente({ hasT2D: true }), 'Semaglutida')!.indication).toBe('dm2');
  });
});

describe('Calendario de monitoreo', () => {
  test('arranca en la visita basal, en la semana 0', () => {
    const plan = monitoringPlan(paciente(), titrationFor('Semaglutida', 'obesidad')!);
    expect(plan[0].weeks).toBe(0);
    expect(plan[0].label).toBe('Basal');
  });

  test('queda ordenado por semana', () => {
    const plan = monitoringPlan(paciente({ hasRetinopathy: true, egfr: 45 }), titrationFor('Semaglutida', 'dm2')!);
    const semanas = plan.map((v) => v.weeks);
    expect([...semanas].sort((a, b) => a - b)).toStrictEqual(semanas);
  });

  test('la visita basal pide el laboratorio completo', () => {
    const plan = monitoringPlan(paciente(), titrationFor('Semaglutida', 'obesidad')!);
    expect(plan[0].labs).toContain('hba1c');
    expect(plan[0].labs).toContain('egfr-tfg-estimada');
    expect(plan[0].labs).toContain('alt-tgp');
  });

  test('sin diabetes no pide HbA1c en la semana 12; con diabetes sí', () => {
    const sinDm = monitoringPlan(paciente(), titrationFor('Semaglutida', 'obesidad')!);
    const conDm = monitoringPlan(paciente({ hasT2D: true }), titrationFor('Semaglutida', 'dm2')!);
    expect(labsForVisit(sinDm, 12)).toStrictEqual([]);
    expect(labsForVisit(conDm, 12)).toContain('hba1c');
  });

  test('con retinopatía suma el fondo de ojo a la semana 12', () => {
    const plan = monitoringPlan(paciente({ hasRetinopathy: true }), titrationFor('Semaglutida', 'dm2')!);
    expect(plan.some((v) => v.weeks === 12 && v.checks.some((c) => /fondo de ojo/i.test(c)))).toBe(true);
  });

  test('con deterioro renal suma el seguimiento de albuminuria', () => {
    const plan = monitoringPlan(paciente({ egfr: 45 }), titrationFor('Semaglutida', 'dm2')!);
    expect(plan.some((v) => v.checks.some((c) => /UACR/.test(c)))).toBe(true);
  });

  // Si el pedido no coincide con el catálogo, el recetario no lo puede armar.
  test('todos los estudios existen en el catálogo de biomarcadores', () => {
    const plan = monitoringPlan(paciente({ hasT2D: true, egfr: 45 }), titrationFor('Semaglutida', 'dm2')!);
    const desconocidos = [...new Set(plan.flatMap((v) => v.labs))].filter((s) => !SLUGS_CATALOGO.has(s));
    expect(desconocidos).toStrictEqual([]);
  });
});

describe('Revisión de respuesta', () => {
  // El punto del ejercicio: no juzgar el resultado antes de que el tratamiento
  // esté en dosis terapéutica.
  test('cae 12 semanas después de alcanzar la dosis terapéutica', () => {
    const sema = titrationFor('Semaglutida', 'obesidad')!;
    expect(responseReview(sema).weeks).toBe(weeksToTherapeuticDose(sema) + 12);
    expect(responseReview(sema).weeks).toBe(20);
  });

  test('con dulaglutida, que arranca terapéutica, la revisión es a la semana 12', () => {
    expect(responseReview(titrationFor('Dulaglutida', 'dm2')!).weeks).toBe(12);
  });

  test('el criterio es 5 % del peso basal', () => {
    expect(responseReview(titrationFor('Semaglutida', 'obesidad')!).criterion).toMatch(/5 %/);
  });

  test('antes de concluir que no responde, manda revisar dosis y adherencia', () => {
    const r = responseReview(titrationFor('Semaglutida', 'obesidad')!);
    expect(r.ifNotMet.some((x) => /dosis terapéutica/i.test(x))).toBe(true);
    expect(r.ifNotMet.some((x) => /aplicación|salteos/i.test(x))).toBe(true);
    // El cambio de molécula es lo último, no lo primero.
    expect(r.ifNotMet[r.ifNotMet.length - 1]).toMatch(/cambio de molécula/i);
  });
});

describe('Caso clínico: mujer de 48 con DM2 e insulina', () => {
  test('esquema de DM2, ajuste de insulina y automonitoreo', () => {
    const p = buildProtocol(
      paciente({ ageYears: 48, sex: 'female', hasT2D: true, hba1cPercent: 8.1, onInsulin: true, egfr: 52, uacrMgG: 85 }),
      'Semaglutida'
    )!;
    expect(p.indication).toBe('dm2');
    expect(p.adjustments.some((a) => /insulina/i.test(a.text))).toBe(true);
    expect(p.safety.some((s) => /hipoglucemia/i.test(s.text))).toBe(true);
    expect(p.safety.some((s) => /embarazo/i.test(s.text))).toBe(true);
    expect(p.monitoring.some((v) => v.checks.some((c) => /UACR/.test(c)))).toBe(true);
  });
});

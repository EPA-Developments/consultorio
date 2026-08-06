import { buildGLP1Plan, GLP1_CAREPLAN_CATEGORY, glp1CarePlan, glp1Tasks, visitDate } from './careplan';
import type { GLP1Inputs } from './eligibility';
import { PROTOCOL_VERIFIED } from './eligibility';
import { buildProtocol } from './protocol';

const INICIO = '2026-08-06T12:00:00.000Z';

function paciente(extra: Partial<GLP1Inputs> = {}): GLP1Inputs {
  return { ageYears: 52, sex: 'male', bmi: 33, waistCm: 105, hba1cPercent: 5.6, egfr: 90, ...extra };
}

const protocolo = (extra: Partial<GLP1Inputs> = {}, molecula = 'Semaglutida') =>
  buildProtocol(paciente(extra), molecula)!;

describe('visitDate', () => {
  test('la semana N cae N×7 días después del inicio', () => {
    expect(visitDate(INICIO, 0)).toBe(INICIO);
    expect(visitDate(INICIO, 4).slice(0, 10)).toBe('2026-09-03');
    expect(visitDate(INICIO, 26).slice(0, 10)).toBe('2027-02-04');
  });
});

describe('glp1CarePlan', () => {
  test('nace en borrador: lo activa el médico, no el sistema', () => {
    const cp = glp1CarePlan(protocolo(), 'p1', INICIO);
    expect(cp.status).toBe('draft');
    expect(cp.intent).toBe('plan');
  });

  test('el período va del inicio al último control', () => {
    const p = protocolo();
    const cp = glp1CarePlan(p, 'p1', INICIO);
    const ultima = Math.max(...p.monitoring.map((v) => v.weeks));
    expect(cp.period?.start).toBe(INICIO);
    expect(cp.period?.end).toBe(visitDate(INICIO, ultima));
  });

  test('la primera actividad es la titulación, con los escalones y el tope', () => {
    const cp = glp1CarePlan(protocolo(), 'p1', INICIO);
    const titulacion = cp.activity?.[0]?.detail;
    expect(titulacion?.code?.text).toContain('Titulación');
    expect(titulacion?.description).toContain('0,25 mg');
    expect(titulacion?.description).toContain('2,4 mg');
  });

  test('cada control queda como actividad con su fecha prevista', () => {
    const p = protocolo();
    const cp = glp1CarePlan(p, 'p1', INICIO);
    // Una actividad de titulación + una por control.
    expect(cp.activity).toHaveLength(p.monitoring.length + 1);
    for (const v of p.monitoring) {
      const act = cp.activity?.find((a) => a.detail?.code?.text === v.label);
      expect(act?.detail?.scheduledPeriod?.start, v.label).toBe(visitDate(INICIO, v.weeks));
    }
  });

  test('las notas arrastran los ajustes, la vigilancia y el criterio de respuesta', () => {
    const cp = glp1CarePlan(protocolo({ onInsulin: true, hasT2D: true }), 'p1', INICIO);
    const texto = (cp.note ?? []).map((n) => n.text).join('\n');
    expect(texto).toMatch(/Ajuste:.*insulina/i);
    expect(texto).toMatch(/Vigilar:.*pancreatitis/i);
    expect(texto).toMatch(/Revisión de respuesta en la semana/);
  });

  test('mientras el protocolo no esté validado, el plan lo dice en la primera nota', () => {
    const cp = glp1CarePlan(protocolo(), 'p1', INICIO);
    expect(PROTOCOL_VERIFIED).toBe(false);
    expect(cp.note?.[0]?.text).toMatch(/provisional|validac/i);
  });

  test('queda categorizado para reconocerlo entre los planes del paciente', () => {
    expect(glp1CarePlan(protocolo(), 'p1', INICIO).category).toStrictEqual([GLP1_CAREPLAN_CATEGORY]);
  });
});

describe('glp1Tasks', () => {
  // 'requested' es lo que hace que el control aparezca en el tablero del médico
  // (ver ACTIVE_TASK_STATUSES en home-data).
  test('quedan en requested, que es el estado que las muestra en el tablero', () => {
    const tasks = glp1Tasks(protocolo(), 'p1', INICIO);
    expect(tasks.every((t) => t.status === 'requested')).toBe(true);
    expect(tasks.every((t) => t.intent === 'plan')).toBe(true);
  });

  test('una Task por control, cada una con su fecha', () => {
    const p = protocolo();
    const tasks = glp1Tasks(p, 'p1', INICIO);
    expect(tasks).toHaveLength(p.monitoring.length);
    for (const [k, v] of p.monitoring.entries()) {
      expect(tasks[k].executionPeriod?.start, v.label).toBe(visitDate(INICIO, v.weeks));
    }
  });

  test('el título nombra la molécula y el control, para que se entienda en la lista', () => {
    const tasks = glp1Tasks(protocolo(), 'p1', INICIO);
    expect(tasks[0].code?.text).toContain('Semaglutida');
    expect(tasks[0].code?.text).toContain('Basal');
  });

  test('la descripción arrastra los chequeos y los estudios del control', () => {
    const tasks = glp1Tasks(protocolo(), 'p1', INICIO);
    const basal = tasks.find((t) => t.code?.text?.includes('Basal'))!;
    expect(basal.description).toContain('Peso e IMC');
    expect(basal.description).toContain('Estudios:');
    expect(basal.description).toContain('hba1c');
  });

  test('apuntan al paciente y, si se pasa referencia, al plan', () => {
    const sinPlan = glp1Tasks(protocolo(), 'p1', INICIO);
    expect(sinPlan.every((t) => t.for?.reference === 'Patient/p1')).toBe(true);
    expect(sinPlan.every((t) => t.basedOn === undefined)).toBe(true);

    const conPlan = glp1Tasks(protocolo(), 'p1', INICIO, 'urn:uuid:abc');
    expect(conPlan.every((t) => t.basedOn?.[0]?.reference === 'urn:uuid:abc')).toBe(true);
  });
});

describe('buildGLP1Plan', () => {
  test('devuelve el plan y sus controles atados entre sí', () => {
    const { carePlan, tasks } = buildGLP1Plan(protocolo(), 'p1', INICIO, 'urn:uuid:plan');
    expect(carePlan.resourceType).toBe('CarePlan');
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.basedOn?.[0]?.reference === 'urn:uuid:plan')).toBe(true);
  });

  test('el paciente con diabetes y riñón recibe más controles que el sano', () => {
    const simple = buildGLP1Plan(protocolo(), 'p1', INICIO).tasks.length;
    const complejo = buildGLP1Plan(
      protocolo({ hasT2D: true, hba1cPercent: 8.1, egfr: 45, uacrMgG: 85, hasRetinopathy: true }),
      'p1',
      INICIO
    ).tasks.length;
    expect(complejo).toBeGreaterThan(simple);
  });

  // La semana de revisión que queda escrita en el plan sale del esquema, no de
  // una constante. Tres esquemas, tres semanas distintas:
  //   - Semaglutida para peso: terapéutica en la semana 8  -> revisión 20
  //   - Semaglutida para DM2:  terapéutica en la semana 4  -> revisión 16
  //   - Dulaglutida:           terapéutica desde el inicio -> revisión 12
  test('la semana de revisión que queda en el plan depende del esquema', () => {
    const semanaRevision = (i: GLP1Inputs, molecula: string): number => {
      const plan = buildGLP1Plan(buildProtocol(i, molecula)!, 'p1', INICIO);
      return Number(/Revisión de respuesta en la semana (\d+)/i.exec(
        plan.carePlan.note?.map((n) => n.text).join(' ') ?? ''
      )?.[1]);
    };
    const conDm2 = paciente({ hasT2D: true });
    expect(semanaRevision(paciente(), 'Semaglutida')).toBe(20);
    expect(semanaRevision(conDm2, 'Semaglutida')).toBe(16);
    expect(semanaRevision(conDm2, 'Dulaglutida')).toBe(12);
  });
});

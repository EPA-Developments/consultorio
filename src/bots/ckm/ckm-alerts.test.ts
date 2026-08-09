import type { Bundle, Communication, DetectedIssue, Observation, Patient, Task } from '@medplum/fhirtypes';
import { ALERT_RULE_SYSTEM } from '../../ckm/alert-rules';
import type { TriggeredAlert } from '../../ckm/alert-rules';
import { LOINC, LOINC_BP_PANEL, LOINC_SYSTEM } from '../../ckm/constants';
import {
  ALERT_INSTANCE_SYSTEM,
  COOLDOWN_DIAS,
  enCooldown,
  evaluarYAlertar,
  handler,
  instanciaDe,
  recursosDeAlerta,
} from './ckm-alerts';

const AHORA = new Date('2026-08-09T12:00:00Z');

const ALERTA: TriggeredAlert = {
  ruleId: 'sbp-high',
  param: 'sbp',
  label: 'Presión sistólica elevada',
  count: 3,
  latestValue: 150,
  threshold: 140,
  unit: 'mmHg',
  message:
    'Presión sistólica elevada: 3 registros ≥ 140 mmHg (último 150 mmHg). Considere ajuste terapéutico o adelantar el control.',
};

function issuePrevio(ruleId: string, cuando: string): DetectedIssue {
  return {
    resourceType: 'DetectedIssue',
    status: 'final',
    code: { coding: [{ system: ALERT_RULE_SYSTEM, code: ruleId }] },
    identifiedDateTime: cuando,
  };
}

function diasAtras(n: number): string {
  return new Date(AHORA.getTime() - n * 24 * 3600 * 1000).toISOString();
}

function bpPanel(patientId: string, sistolica: number, fecha: string): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: fecha,
    code: { coding: [{ system: LOINC_SYSTEM, code: LOINC_BP_PANEL }] },
    component: [
      {
        code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.sbp }] },
        valueQuantity: { value: sistolica, unit: 'mmHg' },
      },
      { code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.dbp }] }, valueQuantity: { value: 85, unit: 'mmHg' } },
    ],
  };
}

/** Medplum falso: registra búsquedas y batches sin red. */
function fakeMedplum(opts: { patient?: Patient; observations?: Observation[]; issues?: DetectedIssue[] }): {
  medplum: any;
  batches: Bundle[];
} {
  const batches: Bundle[] = [];
  const medplum = {
    readResource: async (_type: string, _id: string) => opts.patient,
    searchResources: async (type: string, _query: unknown) => {
      if (type === 'Observation') {
        return opts.observations ?? [];
      }
      if (type === 'DetectedIssue') {
        return opts.issues ?? [];
      }
      return [];
    },
    executeBatch: async (bundle: Bundle) => {
      batches.push(bundle);
      return bundle;
    },
  };
  return { medplum, batches };
}

const PACIENTE: Patient = { resourceType: 'Patient', id: 'p1', gender: 'male' };

describe('Cooldown', () => {
  test('una alerta de la misma regla hace 10 días frena la nueva', () => {
    expect(enCooldown([issuePrevio('sbp-high', diasAtras(10))], 'sbp-high', AHORA)).toBe(true);
  });

  test('a los 31 días la regla vuelve a estar habilitada', () => {
    expect(enCooldown([issuePrevio('sbp-high', diasAtras(COOLDOWN_DIAS + 1))], 'sbp-high', AHORA)).toBe(false);
  });

  test('el cooldown es POR REGLA: una alerta de LDL no frena una de presión', () => {
    expect(enCooldown([issuePrevio('ldl-high', diasAtras(5))], 'sbp-high', AHORA)).toBe(false);
  });

  test('un DetectedIssue de otro sistema de códigos no cuenta', () => {
    const ajeno: DetectedIssue = {
      resourceType: 'DetectedIssue',
      status: 'final',
      code: { coding: [{ system: 'http://otro.sistema', code: 'sbp-high' }] },
      identifiedDateTime: diasAtras(5),
    };
    expect(enCooldown([ajeno], 'sbp-high', AHORA)).toBe(false);
  });

  // Ante la duda, no repetir: el costo de un duplicado es acostumbrar al
  // médico a ignorar las alertas.
  test('un issue de la regla sin fecha legible cuenta como reciente', () => {
    const sinFecha: DetectedIssue = {
      resourceType: 'DetectedIssue',
      status: 'final',
      code: { coding: [{ system: ALERT_RULE_SYSTEM, code: 'sbp-high' }] },
    };
    expect(enCooldown([sinFecha], 'sbp-high', AHORA)).toBe(true);
  });
});

describe('Los tres recursos de una alerta', () => {
  const bundle = recursosDeAlerta(ALERTA, 'p1', AHORA);
  const recursos = (bundle.entry ?? []).map((e) => e.resource);

  test('es una transacción con DetectedIssue + Task + Communication', () => {
    expect(bundle.type).toBe('transaction');
    expect(recursos.map((r) => r?.resourceType)).toStrictEqual(['DetectedIssue', 'Task', 'Communication']);
  });

  test('el DetectedIssue lleva la regla en el sistema que verify-alerts busca', () => {
    const issue = recursos[0] as DetectedIssue;
    expect(issue.code?.coding?.[0]).toMatchObject({ system: ALERT_RULE_SYSTEM, code: 'sbp-high' });
    expect(issue.patient?.reference).toBe('Patient/p1');
    expect(issue.detail).toContain('3 registros');
  });

  test('la Task es buscable por patient (via for) y describe qué revisar', () => {
    const task = recursos[1] as Task;
    expect(task.for?.reference).toBe('Patient/p1');
    expect(task.status).toBe('requested');
    expect(task.code?.text).toMatch(/Revisar tendencia/);
  });

  test('la Communication sale sin leer y con la categoría que el panel filtra', () => {
    const c = recursos[2] as Communication;
    expect(c.status).toBe('in-progress'); // el panel cuenta status !== 'completed'
    expect(c.category?.[0]?.coding?.[0]).toMatchObject({ code: 'alert' });
    expect(c.subject?.reference).toBe('Patient/p1');
    expect(c.payload?.[0]?.contentString).toContain('Presión sistólica elevada');
  });

  // La carrera que la verificación de producción mostró: un laboratorio entra
  // como varias Observations en ráfaga, y la misma alerta salió TRIPLICADA
  // porque las ejecuciones concurrentes leen el cooldown antes de que ninguna
  // escriba. El ifNoneExist con identifier determinístico es lo que deduplica.
  test('los tres recursos llevan ifNoneExist con el identifier de instancia', () => {
    const esperado = `identifier=${ALERT_INSTANCE_SYSTEM}|sbp-high-p1-2026-08`;
    for (const e of bundle.entry ?? []) {
      expect(e.request?.ifNoneExist).toBe(esperado);
      expect((e.resource as DetectedIssue).identifier?.[0]?.value).toBe('sbp-high-p1-2026-08');
    }
  });

  test('dos ejecuciones concurrentes en el mismo mes producen la MISMA instancia', () => {
    const unSegundoDespues = new Date(AHORA.getTime() + 1000);
    expect(instanciaDe('sbp-high', 'p1', AHORA)).toBe(instanciaDe('sbp-high', 'p1', unSegundoDespues));
  });

  test('la instancia cambia por regla, por paciente y por mes', () => {
    const base = instanciaDe('sbp-high', 'p1', AHORA);
    expect(instanciaDe('ldl-high', 'p1', AHORA)).not.toBe(base);
    expect(instanciaDe('sbp-high', 'p2', AHORA)).not.toBe(base);
    expect(instanciaDe('sbp-high', 'p1', new Date('2026-09-09T12:00:00Z'))).not.toBe(base);
  });
});

describe('El circuito completo', () => {
  const tresAltas = [
    bpPanel('p1', 145, diasAtras(2)),
    bpPanel('p1', 148, diasAtras(1)),
    bpPanel('p1', 150, diasAtras(0)),
  ];

  test('tres presiones altas crean la alerta', async () => {
    const { medplum, batches } = fakeMedplum({ patient: PACIENTE, observations: tresAltas });
    const creadas = await evaluarYAlertar(medplum, PACIENTE, AHORA);
    expect(creadas).toContain('sbp-high');
    expect(batches.length).toBeGreaterThan(0);
  });

  test('con una alerta reciente de la regla, no se repite', async () => {
    const { medplum, batches } = fakeMedplum({
      patient: PACIENTE,
      observations: tresAltas,
      issues: [issuePrevio('sbp-high', diasAtras(3))],
    });
    const creadas = await evaluarYAlertar(medplum, PACIENTE, AHORA);
    expect(creadas).not.toContain('sbp-high');
    // dbp normal (85): la única regla que dispara es sbp-high, así que no hay batches
    expect(batches).toStrictEqual([]);
  });

  test('dos presiones altas no alcanzan: la regla pide tres', async () => {
    const { medplum, batches } = fakeMedplum({
      patient: PACIENTE,
      observations: [bpPanel('p1', 145, diasAtras(1)), bpPanel('p1', 150, diasAtras(0))],
    });
    const creadas = await evaluarYAlertar(medplum, PACIENTE, AHORA);
    expect(creadas).toStrictEqual([]);
    expect(batches).toStrictEqual([]);
  });

  test('el handler ignora Observations que no son CKM', async () => {
    const { medplum, batches } = fakeMedplum({ patient: PACIENTE });
    const ajena: Observation = {
      resourceType: 'Observation',
      status: 'final',
      subject: { reference: 'Patient/p1' },
      code: { coding: [{ system: LOINC_SYSTEM, code: '718-7' }] }, // hemoglobina: no CKM
    };
    const creadas = await handler(medplum, { input: ajena } as any);
    expect(creadas).toStrictEqual([]);
    expect(batches).toStrictEqual([]);
  });

  test('el handler procesa una Observation CKM de punta a punta', async () => {
    const { medplum } = fakeMedplum({ patient: PACIENTE, observations: tresAltas });
    const creadas = await handler(medplum, { input: tresAltas[2] } as any);
    expect(creadas).toContain('sbp-high');
  });
});

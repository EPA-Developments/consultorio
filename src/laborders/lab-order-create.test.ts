import type { Bot, Bundle, Patient, Practitioner, ServiceRequest } from '@medplum/fhirtypes';
import { LOINC_SYSTEM } from '../ckm/observation-definitions';
import type { LabOrderItem } from './lab-order';
import { createLabOrder, EXT_REFEPS_VERIFICACION } from './lab-order-create';
import { EmissionBlockedError } from './practitioner-validation';
import type { RefepsVerification } from './refeps';

const PACIENTE: Patient = { resourceType: 'Patient', id: 'p1' };

// El Practitioner real del admin: matrícula bajo el dominio de REFEPS.
const MEDICO: Practitioner = {
  resourceType: 'Practitioner',
  id: 'dr1',
  gender: 'male',
  name: [{ given: ['Alejandro'], family: "D'Alessandro" }],
  identifier: [
    { system: 'http://refeps.msal.gob.ar', value: 'MN-92179' },
    { system: 'http://afip.gob.ar', value: '20-20541993-5' },
  ],
};

const ITEMS: LabOrderItem[] = [
  {
    biomarcadorId: 'glucosa-en-ayunas',
    label: 'Glucosa en Ayunas',
    code: '1558-6',
    system: LOINC_SYSTEM,
    orderability: 'lab',
    orderable: true,
  },
];

function verification(verdict: RefepsVerification['verdict'], message: string): RefepsVerification {
  return { verdict, message, found: [], specialties: [] };
}

/**
 * Medplum falso del circuito de emisión: perfil, bot REFEPS y batches.
 * `sinBot` simula el Bus/bot inalcanzable (checkRefeps → unavailable).
 */
function fakeMedplum(opts: { profile?: Practitioner; veredicto?: RefepsVerification; sinBot?: boolean }): {
  medplum: any;
  batches: Bundle[];
  botCalls: number;
} {
  const batches: Bundle[] = [];
  const state = { botCalls: 0 };
  const medplum = {
    getProfile: () => opts.profile,
    searchOne: async (type: string, _q: string) =>
      type === 'Bot' && !opts.sinBot ? ({ resourceType: 'Bot', id: 'bot-refeps' } as Bot) : undefined,
    executeBot: async (_id: string, _input: unknown) => {
      state.botCalls++;
      return opts.veredicto;
    },
    executeBatch: async (bundle: Bundle) => {
      batches.push(bundle);
      return bundle;
    },
  };
  return {
    medplum,
    batches,
    get botCalls() {
      return state.botCalls;
    },
  } as any;
}

function ordenes(batches: Bundle[]): ServiceRequest[] {
  return batches.flatMap((b) => (b.entry ?? []).map((e) => e.resource as ServiceRequest));
}

describe('Emisión con REFEPS verificado', () => {
  test('emite, y la constancia viaja en la nota y en la extensión', async () => {
    const ctx = fakeMedplum({ profile: MEDICO, veredicto: verification('verificado', 'Matrícula verificada.') });
    const r = await createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS, note: 'Cobertura: OSDE' });

    expect(r.refeps?.verification?.verdict).toBe('verificado');
    const [sr] = ordenes(ctx.batches);
    expect(sr.note?.[0]?.text).toContain('Cobertura: OSDE');
    expect(sr.note?.[0]?.text).toContain('Matrícula verificada en REFEPS');
    expect(sr.extension?.find((e) => e.url === EXT_REFEPS_VERIFICACION)?.valueString).toBe('verificado');
  });
});

describe('Emisión con rechazo del registro', () => {
  // Acá REFEPS CONTESTÓ y dijo que no: la orden no debe existir.
  test('un rechazo bloquea con el motivo y no escribe nada', async () => {
    const ctx = fakeMedplum({
      profile: MEDICO,
      veredicto: verification('matricula-no-coincide', 'La matrícula cargada no coincide con las de REFEPS (12345).'),
    });
    await expect(createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS })).rejects.toThrow(
      EmissionBlockedError
    );
    await expect(createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS })).rejects.toThrow(/no coincide/);
    expect(ctx.batches).toStrictEqual([]);
  });

  test('profesional inactivo también bloquea', async () => {
    const ctx = fakeMedplum({
      profile: MEDICO,
      veredicto: verification('profesional-inactivo', 'El profesional figura como inactivo en REFEPS.'),
    });
    await expect(createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS })).rejects.toThrow(/inactivo/);
    expect(ctx.batches).toStrictEqual([]);
  });
});

describe('Emisión con el registro caído', () => {
  // Un 503 del Estado no convierte a un profesional matriculado en uno que no
  // lo está: la orden sale, con la constancia de que salió sin verificar.
  test('unavailable emite igual y deja constancia honesta', async () => {
    const ctx = fakeMedplum({ profile: MEDICO, sinBot: true });
    const r = await createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS });

    expect(r.refeps?.unavailable).toBe(true);
    const [sr] = ordenes(ctx.batches);
    expect(sr.note?.[0]?.text).toContain('sin verificar contra REFEPS');
    expect(sr.extension?.find((e) => e.url === EXT_REFEPS_VERIFICACION)?.valueString).toBe('no-verificable');
  });
});

describe('Qué NO pasa por REFEPS', () => {
  test('las propuestas del paciente no consultan el registro', async () => {
    const ctx = fakeMedplum({ profile: undefined, veredicto: verification('verificado', 'x') });
    const r = await createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS, intent: 'proposal' });
    expect(r.refeps).toBeUndefined();
    expect(ctx.botCalls).toBe(0);
    const [sr] = ordenes(ctx.batches);
    expect(sr.extension?.find((e) => e.url === EXT_REFEPS_VERIFICACION)).toBeUndefined();
  });

  // La validación local va primero: sin matrícula cargada no hay nada que
  // preguntarle al registro.
  test('sin matrícula bloquea localmente, antes de llamar al bot', async () => {
    const sinMatricula: Practitioner = { resourceType: 'Practitioner', id: 'dr2' };
    const ctx = fakeMedplum({ profile: sinMatricula, veredicto: verification('verificado', 'x') });
    await expect(createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS })).rejects.toThrow(
      EmissionBlockedError
    );
    expect(ctx.botCalls).toBe(0);
    expect(ctx.batches).toStrictEqual([]);
  });
});

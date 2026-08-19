import type { Bot, Bundle, Patient, Practitioner, Provenance, ServiceRequest } from '@medplum/fhirtypes';
import { LOINC_SYSTEM } from '../ckm/observation-definitions';
import type { LabOrderItem } from './lab-order';
import { createLabOrder, EXT_REFEPS_VERIFICACION } from './lab-order-create';
import { getSello, SELLO_SYSTEM, verifySeal } from './lab-order-emission';
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
  return batches.flatMap((b) =>
    (b.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is ServiceRequest => r?.resourceType === 'ServiceRequest')
  );
}

function provenances(batches: Bundle[]): Provenance[] {
  return batches.flatMap((b) =>
    (b.entry ?? []).map((e) => e.resource).filter((r): r is Provenance => r?.resourceType === 'Provenance')
  );
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

// Fase 2 del recetario: emitir ES el acto firmado del profesional. Antes de
// esto lab-order-emission era un módulo entero con tests y SIN llamador — y
// para el regulador una capacidad que no está en el circuito no existe.
describe('Sello de integridad y firma', () => {
  test('sella cada orden y firma en la MISMA transacción', async () => {
    const ctx = fakeMedplum({ profile: MEDICO, veredicto: verification('verificado', 'Matrícula verificada.') });
    await createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS });

    expect(ctx.batches).toHaveLength(1);
    const srs = ordenes(ctx.batches);
    const provs = provenances(ctx.batches);
    expect(provs).toHaveLength(1);

    // Todas las órdenes del pedido llevan el MISMO sello: es el hash del
    // contenido de la requisición, no de cada análisis suelto.
    const sellos = new Set(srs.map(getSello));
    expect(sellos.size).toBe(1);
    expect([...sellos][0]).toMatch(/^[0-9a-f]{64}$/);

    // La firma acredita autoría y arrastra el sello para poder auditar sin
    // releer las órdenes.
    const [prov] = provs;
    expect(prov.signature?.[0]?.who?.reference).toBe('Practitioner/dr1');
    expect(prov.extension?.find((e) => e.url === SELLO_SYSTEM)?.valueString).toBe([...sellos][0]);
  });

  test('los targets del Provenance son los urn:uuid de la misma transacción', async () => {
    const ctx = fakeMedplum({ profile: MEDICO, veredicto: verification('verificado', 'ok') });
    await createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS });

    // Las órdenes todavía no existen cuando se arma el Provenance: si los
    // targets no son los fullUrl de esta transacción, el servidor guarda una
    // firma que no apunta a nada.
    const [bundle] = ctx.batches;
    const fullUrls = (bundle.entry ?? []).filter((e) => e.fullUrl).map((e) => e.fullUrl);
    expect(fullUrls.length).toBe(ITEMS.length);
    expect(fullUrls.every((u) => u?.startsWith('urn:uuid:'))).toBe(true);
    const [prov] = provenances(ctx.batches);
    expect(prov.target?.map((t) => t.reference)).toStrictEqual(fullUrls);
  });

  test('el sello devuelto verifica contra el contenido de la orden', async () => {
    const ctx = fakeMedplum({ profile: MEDICO, veredicto: verification('verificado', 'ok') });
    const r = await createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS });
    await expect(verifySeal(r.requests)).resolves.toBe(true);

    // Y detecta la modificación: cambiar un análisis invalida el sello. Es la
    // garantía de inalterabilidad que pide el art. 4 del Decreto 98/23.
    const alterada = r.requests.map((sr) => ({ ...sr, code: { ...sr.code, text: 'Otra cosa' } }));
    await expect(verifySeal(alterada)).resolves.toBe(false);
  });

  // Una propuesta del paciente no es un acto firmado: nadie matriculado se
  // hizo responsable todavía. Se sella al aprobarse, no antes.
  test('las propuestas del paciente no se sellan ni se firman', async () => {
    const ctx = fakeMedplum({ profile: undefined });
    const r = await createLabOrder(ctx.medplum, { patient: PACIENTE, items: ITEMS, intent: 'proposal' });

    expect(provenances(ctx.batches)).toStrictEqual([]);
    expect(ordenes(ctx.batches).map(getSello)).toStrictEqual([undefined]);
    expect(r.requests.map(getSello)).toStrictEqual([undefined]);
  });
});

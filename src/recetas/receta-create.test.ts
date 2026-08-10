import type { Bot, Bundle, MedicationRequest, Patient, Practitioner } from '@medplum/fhirtypes';
import { EXT_REFEPS_VERIFICACION } from '../laborders/emission-gate';
import { EmissionBlockedError } from '../laborders/practitioner-validation';
import type { RefepsVerification } from '../laborders/refeps';
import { createReceta } from './receta-create';
import type { ItemReceta } from './receta';

const PACIENTE: Patient = { resourceType: 'Patient', id: 'p1' };

const MEDICO: Practitioner = {
  resourceType: 'Practitioner',
  id: 'dr1',
  gender: 'male',
  name: [{ given: ['Alejandro'], family: "D'Alessandro" }],
  identifier: [{ system: 'http://refeps.msal.gob.ar', value: 'MN-92179' }],
};

const ITEM: ItemReceta = {
  dci: 'metformina',
  presentacion: 'comprimidos 500 mg',
  cantidad: 2,
  posologia: '1 comprimido cada 12 h, 30 días',
};

function verification(verdict: RefepsVerification['verdict'], message: string): RefepsVerification {
  return { verdict, message, found: [], specialties: [] };
}

function fakeMedplum(opts: { profile?: Practitioner; veredicto?: RefepsVerification; sinBot?: boolean }): {
  medplum: any;
  batches: Bundle[];
} {
  const batches: Bundle[] = [];
  const medplum = {
    getProfile: () => opts.profile,
    searchOne: async (type: string, _q: string) =>
      type === 'Bot' && !opts.sinBot ? ({ resourceType: 'Bot', id: 'bot-refeps' } as Bot) : undefined,
    executeBot: async () => opts.veredicto,
    executeBatch: async (bundle: Bundle) => {
      batches.push(bundle);
      return bundle;
    },
  };
  return { medplum, batches };
}

function recetas(batches: Bundle[]): MedicationRequest[] {
  return batches.flatMap((b) => (b.entry ?? []).map((e) => e.resource as MedicationRequest));
}

describe('Emisión de receta: el mismo gate que las órdenes', () => {
  test('con REFEPS verificado emite, con constancia en nota y extensión', async () => {
    const ctx = fakeMedplum({ profile: MEDICO, veredicto: verification('verificado', 'ok') });
    const r = await createReceta(ctx.medplum, { patient: PACIENTE, items: [ITEM], diagnostico: 'DM2 (E11.9)' });

    expect(r.refeps.verification?.verdict).toBe('verificado');
    expect(r.recetaId).toMatch(/^REC-/);
    const [mr] = recetas(ctx.batches);
    expect(mr.note?.some((n) => n.text?.includes('Matrícula verificada en REFEPS'))).toBe(true);
    expect(mr.extension?.find((e) => e.url === EXT_REFEPS_VERIFICACION)?.valueString).toBe('verificado');
  });

  test('un rechazo del registro bloquea y no escribe nada', async () => {
    const ctx = fakeMedplum({
      profile: MEDICO,
      veredicto: verification('matricula-no-habilitada', 'La matrícula no está habilitada.'),
    });
    await expect(createReceta(ctx.medplum, { patient: PACIENTE, items: [ITEM], diagnostico: 'DM2' })).rejects.toThrow(
      /no está habilitada/
    );
    expect(ctx.batches).toStrictEqual([]);
  });

  test('con el registro caído emite igual, con constancia honesta', async () => {
    const ctx = fakeMedplum({ profile: MEDICO, sinBot: true });
    const r = await createReceta(ctx.medplum, { patient: PACIENTE, items: [ITEM], diagnostico: 'DM2' });
    expect(r.refeps.unavailable).toBe(true);
    const [mr] = recetas(ctx.batches);
    expect(mr.extension?.find((e) => e.url === EXT_REFEPS_VERIFICACION)?.valueString).toBe('no-verificable');
  });

  // El contenido se valida ANTES que el emisor: no tiene sentido consultar el
  // registro federal para una receta a la que le falta la posología.
  test('una receta inválida bloquea antes de tocar el bot, con TODOS los problemas', async () => {
    const ctx = fakeMedplum({ profile: MEDICO, veredicto: verification('verificado', 'ok') });
    let error: EmissionBlockedError | undefined;
    try {
      await createReceta(ctx.medplum, {
        patient: PACIENTE,
        items: [{ dci: '', presentacion: '', cantidad: 0, posologia: '' }],
        diagnostico: '',
      });
    } catch (e) {
      error = e as EmissionBlockedError;
    }
    expect(error).toBeInstanceOf(EmissionBlockedError);
    expect(error?.message).toContain('25.649');
    expect(ctx.batches).toStrictEqual([]);
  });

  test('sin matrícula bloquea localmente (mismo gate que la orden de laboratorio)', async () => {
    const sinMatricula: Practitioner = {
      resourceType: 'Practitioner',
      id: 'dr2',
      name: [{ given: ['X'], family: 'Y' }],
    };
    const ctx = fakeMedplum({ profile: sinMatricula, veredicto: verification('verificado', 'ok') });
    await expect(createReceta(ctx.medplum, { patient: PACIENTE, items: [ITEM], diagnostico: 'DM2' })).rejects.toThrow(
      EmissionBlockedError
    );
    expect(ctx.batches).toStrictEqual([]);
  });

  test('todo va en UNA transacción de MedicationRequest', async () => {
    const ctx = fakeMedplum({ profile: MEDICO, veredicto: verification('verificado', 'ok') });
    await createReceta(ctx.medplum, {
      patient: PACIENTE,
      items: [ITEM, { dci: 'rosuvastatina', cantidad: 1, posologia: '10 mg/día, 90 días' }],
      diagnostico: 'DM2 + dislipemia',
    });
    expect(ctx.batches).toHaveLength(1);
    expect(ctx.batches[0].type).toBe('transaction');
    expect(ctx.batches[0].entry?.every((e) => e.request?.url === 'MedicationRequest')).toBe(true);
  });
});

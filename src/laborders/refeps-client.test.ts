import type { MedplumClient } from '@medplum/core';
import type { Bot, Practitioner } from '@medplum/fhirtypes';
import { checkRefeps, isRejected, isVerified, REFEPS_BOT_NAME } from './refeps-client';

const MEDICO: Practitioner = { resourceType: 'Practitioner', id: 'p1' };
const PROYECTO = '78ead38c-0f59-4576-b196-71685537588c';
const BIOWELLNESS = '7f068d7d-4633-46e9-9eff-d52bc03625b9';

/**
 * Cliente falso. `botAusente` es explícito en vez de `bot: undefined` porque
 * con `??` no se distingue "no me lo pasaron" de "me lo pasaron vacío".
 */
function fakeMedplum(over: {
  botAusente?: boolean;
  result?: unknown;
  throws?: Error;
  /** Bots que devuelve la búsqueda por nombre, incluidos los de otros proyectos. */
  bots?: Bot[];
}): MedplumClient {
  const encontrados =
    over.bots ??
    (over.botAusente ? [] : [{ resourceType: 'Bot', id: 'bot-1', name: REFEPS_BOT_NAME, meta: { project: PROYECTO } }]);
  return {
    getProject: () => ({ resourceType: 'Project', id: PROYECTO }),
    searchResources: async () => encontrados,
    executeBot: async () => {
      if (over.throws) {
        throw over.throws;
      }
      return over.result;
    },
  } as unknown as MedplumClient;
}

describe('checkRefeps', () => {
  test('devuelve el veredicto del bot', async () => {
    const r = await checkRefeps(
      fakeMedplum({ result: { verdict: 'verificado', message: 'ok', found: [], specialties: [] } }),
      MEDICO
    );
    expect(r.unavailable).toBe(false);
    expect(r.verification?.verdict).toBe('verificado');
  });

  // Lo esencial: si el Bus se cae, el profesional no dejó de estar matriculado.
  test('un error del bot es "no disponible", no un rechazo', async () => {
    const r = await checkRefeps(fakeMedplum({ throws: new Error('HTTP 503') }), MEDICO);
    expect(r.unavailable).toBe(true);
    expect(r.unavailableReason).toContain('503');
    expect(isRejected(r)).toBe(false);
    expect(isVerified(r)).toBe(false);
  });

  test('si el bot no está desplegado lo dice, y no rechaza', async () => {
    const r = await checkRefeps(fakeMedplum({ botAusente: true }), MEDICO);
    expect(r.unavailable).toBe(true);
    expect(r.unavailableReason).toContain(REFEPS_BOT_NAME);
    expect(isRejected(r)).toBe(false);
  });

  // El proyecto linkea a otros y sus bots aparecen en la misma búsqueda.
  // Mandarle nuestro Practitioner al bot de otro consultorio sería filtrarle
  // datos: si el único candidato es ajeno, para nosotros el bot no está.
  test('no ejecuta el bot de otro proyecto', async () => {
    const ajeno: Bot = {
      resourceType: 'Bot',
      id: 'bot-ajeno',
      name: REFEPS_BOT_NAME,
      meta: { project: BIOWELLNESS } as Bot['meta'],
    };
    const r = await checkRefeps(fakeMedplum({ bots: [ajeno] }), MEDICO);
    expect(r.unavailable).toBe(true);
    expect(r.unavailableReason).toContain(REFEPS_BOT_NAME);
  });

  test('una respuesta sin veredicto no se toma por buena', async () => {
    const r = await checkRefeps(fakeMedplum({ result: { message: 'algo' } }), MEDICO);
    expect(r.unavailable).toBe(true);
    expect(isVerified(r)).toBe(false);
  });

  test('un profesional sin guardar no dispara la consulta', async () => {
    const r = await checkRefeps(fakeMedplum({}), { resourceType: 'Practitioner' });
    expect(r.unavailable).toBe(true);
    expect(r.unavailableReason).toMatch(/no está guardado/);
  });
});

describe('isVerified / isRejected', () => {
  const con = (verdict: string): Parameters<typeof isRejected>[0] => ({
    verification: { verdict, message: '', found: [], specialties: [] } as never,
    unavailable: false,
  });

  test('solo "verificado" habilita', () => {
    expect(isVerified(con('verificado'))).toBe(true);
    for (const v of ['no-encontrado', 'matricula-vencida', 'profesional-inactivo']) {
      expect(isVerified(con(v)), v).toBe(false);
    }
  });

  test('los cinco veredictos de rechazo se reconocen como tales', () => {
    for (const v of [
      'no-encontrado',
      'profesional-inactivo',
      'matricula-no-coincide',
      'matricula-no-habilitada',
      'matricula-vencida',
    ]) {
      expect(isRejected(con(v)), v).toBe(true);
    }
  });

  test('"verificado" no es un rechazo', () => {
    expect(isRejected(con('verificado'))).toBe(false);
  });
});

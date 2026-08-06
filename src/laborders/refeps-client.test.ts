import type { MedplumClient } from '@medplum/core';
import type { Practitioner } from '@medplum/fhirtypes';
import { checkRefeps, isRejected, isVerified, REFEPS_BOT_NAME } from './refeps-client';

const MEDICO: Practitioner = { resourceType: 'Practitioner', id: 'p1' };

/**
 * Cliente falso. `botAusente` es explícito en vez de `bot: undefined` porque
 * con `??` no se distingue "no me lo pasaron" de "me lo pasaron vacío".
 */
function fakeMedplum(over: { botAusente?: boolean; result?: unknown; throws?: Error }): MedplumClient {
  return {
    searchOne: async () => (over.botAusente ? undefined : { id: 'bot-1' }),
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

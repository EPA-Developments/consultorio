import type { Bot } from '@medplum/fhirtypes';
import type { IdentidadBot } from '../bot-names';
import { botsAjenosAlRepo, planearRenombres } from './rename-bots';

const IDENTIDADES: IdentidadBot[] = [
  { src: 'src/bots/ckm/ckm-recalculate.ts', nombre: 'favaloro-ckm-recalculate', legado: 'ckm-recalculate' },
  { src: 'src/bots/refeps/refeps-verify.ts', nombre: 'favaloro-refeps-verify', legado: 'refeps-verify' },
];

function bot(id: string, name: string): Bot {
  return { resourceType: 'Bot', id, name };
}

describe('Plan de renombre', () => {
  test('el bot con el nombre viejo se renombra', () => {
    const plan = planearRenombres([bot('a', 'ckm-recalculate')], IDENTIDADES);
    expect(plan[0]).toMatchObject({ accion: 'renombrar', bot: { id: 'a' } });
  });

  // Correr el script dos veces no debe hacer nada la segunda.
  test('el bot ya migrado no se toca', () => {
    const plan = planearRenombres([bot('a', 'favaloro-ckm-recalculate')], IDENTIDADES);
    expect(plan[0].accion).toBe('ya-migrado');
  });

  test('el bot que no existe lo crea el deploy', () => {
    expect(planearRenombres([], IDENTIDADES).map((p) => p.accion)).toEqual(['ausente', 'ausente']);
  });

  // El caso peligroso: alguien desplegó con los nombres nuevos ANTES de migrar,
  // y ahora hay dos bots y dos Subscriptions sobre el mismo criteria. Renombrar
  // encima dejaría dos bots con el mismo nombre: lo decide una persona.
  test('si existen el viejo y el nuevo, no se toca nada', () => {
    const plan = planearRenombres(
      [bot('viejo', 'ckm-recalculate'), bot('nuevo', 'favaloro-ckm-recalculate')],
      IDENTIDADES
    );
    expect(plan[0]).toMatchObject({ accion: 'conflicto', bot: { id: 'viejo' }, ocupante: { id: 'nuevo' } });
  });

  test('los bots que el repo no despliega se reportan aparte', () => {
    const restos = botsAjenosAlRepo([bot('a', 'ckm-recalculate'), bot('b', 'general-encounter-note')], IDENTIDADES);
    expect(restos.map((b) => b.id)).toEqual(['b']);
  });
});

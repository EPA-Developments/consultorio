import type { Bot, ProjectMembership, Subscription } from '@medplum/fhirtypes';
import type { IdentidadBot } from '../bot-names';
import {
  botsAjenosAlRepo,
  membresiasHuerfanas,
  planearRenombres,
  subscripcionesQueDisparanAfuera,
} from './rename-bots';

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

// La fila `Bot/<id>` sin nombre que aparece en app.medplum.com.ar/admin/bots:
// una membership de ESTE proyecto cuyo Bot vive en otro, así que el admin no
// puede resolverla y muestra la referencia cruda.
describe('Membresías que apuntan a bots de otro proyecto', () => {
  function membership(id: string, profile: string): ProjectMembership {
    return {
      resourceType: 'ProjectMembership',
      id,
      project: { reference: 'Project/favaloro' },
      user: { reference: profile },
      profile: { reference: profile },
    };
  }

  test('detecta la que apunta afuera y deja pasar la propia', () => {
    const propios = [bot('mio', 'favaloro-ckm-recalculate')];
    const huerfanas = membresiasHuerfanas([membership('m1', 'Bot/mio'), membership('m2', 'Bot/ajeno')], propios);
    expect(huerfanas.map((m) => m.id)).toEqual(['m2']);
  });

  // Las membresías de personas no tienen nada que ver con esto.
  test('ignora las membresías que no son de bots', () => {
    expect(membresiasHuerfanas([membership('m3', 'Practitioner/dr1')], [])).toEqual([]);
  });
});

// El caso que de verdad importa: la Subscription es nuestra, matea los recursos
// de nuestros pacientes, y el bot que ejecuta es de otro consultorio.
describe('Subscriptions que disparan afuera', () => {
  function sub(id: string, endpoint: string): Subscription {
    return {
      resourceType: 'Subscription',
      id,
      status: 'active',
      reason: 'x',
      criteria: 'Observation?code=1',
      channel: { type: 'rest-hook', endpoint },
    };
  }

  test('marca la que apunta a un bot que no es del proyecto', () => {
    const propios = [bot('mio', 'favaloro-ckm-recalculate')];
    const afuera = subscripcionesQueDisparanAfuera([sub('s1', 'Bot/mio'), sub('s2', 'Bot/ajeno')], propios);
    expect(afuera.map((s) => s.id)).toEqual(['s2']);
  });

  test('los endpoints que no son bots no le incumben', () => {
    expect(subscripcionesQueDisparanAfuera([sub('s3', 'https://example.org/hook')], [])).toEqual([]);
  });
});

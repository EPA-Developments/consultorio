import type { Bot, Resource } from '@medplum/fhirtypes';
import { agruparPorProyecto, analizar, proyectoDe } from './project-map';
import type { ResumenProyecto } from './project-map';

function conProyecto(id: string, proyecto?: string): Resource {
  return { resourceType: 'Bot', id, ...(proyecto ? { meta: { project: proyecto } } : {}) } as Bot;
}

describe('Agrupado por proyecto', () => {
  test('meta.project sale del extended mode', () => {
    expect(proyectoDe(conProyecto('b1', 'p1'))).toBe('p1');
    expect(proyectoDe(conProyecto('b2'))).toBeUndefined();
  });

  // Sin extended mode meta.project viene vacío: agrupar todo bajo una clave
  // visible es mejor que perder los recursos en silencio.
  test('los recursos sin proyecto quedan en una clave propia, no se descartan', () => {
    const mapa = agruparPorProyecto([conProyecto('b1', 'p1'), conProyecto('b2'), conProyecto('b3', 'p1')]);
    expect(mapa.get('p1')).toHaveLength(2);
    expect(mapa.get('(sin proyecto)')).toHaveLength(1);
  });
});

describe('Veredicto del mapa', () => {
  const base = (over: Partial<ResumenProyecto>): ResumenProyecto => ({
    id: 'p1',
    nombre: 'Proyecto',
    superAdmin: false,
    features: ['bots'],
    conteos: {},
    truncados: {},
    bots: [],
    subscriptions: [],
    clients: [],
    ...over,
  });
  const BOTS = ['ckm-recalculate', 'sdoh-response'];
  const bot = (nombre: string, desplegado = true): ResumenProyecto['bots'][number] => ({
    nombre,
    id: `${nombre}-id`,
    desplegado,
  });

  test('el proyecto con más pacientes es el principal', () => {
    const h = analizar(
      [
        base({ id: 'chico', nombre: 'Chico', conteos: { Patient: 3 } }),
        base({ id: 'grande', nombre: 'Grande', conteos: { Patient: 300 } }),
      ],
      []
    );
    expect(h[0].texto).toContain('Grande');
    expect(h.some((x) => x.nivel === 'aviso' && x.texto.includes('2 proyectos'))).toBe(true);
  });

  // El caso real: el mismo bot desplegado en varios proyectos es lo que produce
  // subscriptions que apuntan a bots de otro proyecto.
  test('avisa cuando un bot existe en más de un proyecto', () => {
    const h = analizar(
      [
        base({ id: 'a', nombre: 'A', conteos: { Patient: 10 }, bots: [bot('ckm-recalculate')] }),
        base({ id: 'b', nombre: 'B', bots: [bot('ckm-recalculate')] }),
      ],
      ['ckm-recalculate']
    );
    expect(h.some((x) => x.texto.includes('existe en 2 proyectos'))).toBe(true);
  });

  test('marca el bot presente pero sin código desplegado', () => {
    const h = analizar(
      [base({ conteos: { Patient: 5 }, bots: [bot('ckm-recalculate', false)] })],
      ['ckm-recalculate']
    );
    expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('SIN código ejecutable'))).toBe(true);
  });

  test('detecta terminología cargada en el proyecto equivocado', () => {
    const h = analizar(
      [
        base({ id: 'app', nombre: 'App', conteos: { Patient: 10 } }),
        base({ id: 'otro', nombre: 'Otro', conteos: { CodeSystem: 1, ValueSet: 1 } }),
      ],
      []
    );
    expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('no la ve'))).toBe(true);
  });

  test('bots sin ninguna subscription activa', () => {
    const h = analizar(
      [
        base({
          conteos: { Patient: 10 },
          bots: [bot('ckm-recalculate')],
          subscriptions: [{ reason: 'ckm-recalculate', status: 'off' }],
        }),
      ],
      ['ckm-recalculate']
    );
    expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('ninguna Subscription activa'))).toBe(true);
  });

  // La explicación de "existe pero mi credencial no lo ve".
  test('señala los clients con AccessPolicy como causa de falsos "no existe"', () => {
    const h = analizar(
      [
        base({
          conteos: { Patient: 10 },
          bots: [bot('ckm-recalculate')],
          subscriptions: [{ reason: 'ckm-recalculate', status: 'active' }],
          clients: [{ id: 'c1', nombre: 'Script client', admin: false, policy: 'AccessPolicy/restringida' }],
        }),
      ],
      ['ckm-recalculate']
    );
    expect(h.some((x) => x.texto.includes('AccessPolicy') && x.texto.includes('NO existe'))).toBe(true);
  });

  test('sin pacientes en ningún lado, lo dice y corta', () => {
    const h = analizar([base({ conteos: {} })], BOTS);
    expect(h).toHaveLength(1);
    expect(h[0].nivel).toBe('problema');
  });
});

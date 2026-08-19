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
    links: [],
    exporta: [],
    valueSets: [],
    ...over,
  });
  const VS = [
    'https://bio.medplum.com.ar/fhir/ValueSet/vademecum-dnm',
    'https://bio.medplum.com.ar/fhir/ValueSet/diagnosticos-snomed-ar',
  ];
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
    const h = analizar([base({ conteos: { Patient: 5 }, bots: [bot('ckm-recalculate', false)] })], ['ckm-recalculate']);
    expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('SIN código ejecutable'))).toBe(true);
  });

  test('detecta terminología cargada en el proyecto equivocado', () => {
    const h = analizar(
      [
        base({ id: 'app', nombre: 'App', conteos: { Patient: 10 } }),
        base({ id: 'otro', nombre: 'Otro', conteos: { CodeSystem: 1, ValueSet: 2 }, valueSets: VS }),
      ],
      []
    );
    expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('no la ve'))).toBe(true);
  });

  // El caso que se vio en el servidor: el proyecto tenía CodeSystem: 2 y
  // ValueSet: 5 propios, así que "tiene terminología" daba ✓ mientras el
  // buscador de medicamentos no encontraba un solo concepto del vademécum.
  test('tener ValueSets propios no es tener los que el buscador consulta', () => {
    const h = analizar(
      [
        base({
          id: 'fav',
          nombre: 'Favaloro',
          conteos: { Patient: 7, CodeSystem: 2, ValueSet: 5 },
          valueSets: ['https://ejemplo/ValueSet/otra-cosa'],
        }),
      ],
      []
    );
    expect(h.some((x) => x.nivel === 'ok' && x.texto.includes('terminología'))).toBe(false);
    expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('vademecum-dnm'))).toBe(true);
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
  // El proyecto `umls` (terminología) sirve SNOMED y el vademécum a todos los
  // consultorios por link. El mapa tiene que entender esa forma, y sobre todo
  // tiene que distinguirla del fallo silencioso: linkear sin exportar.
  test('la terminología en un proyecto linkeado que exporta cuenta como visible', () => {
    const h = analizar(
      [
        base({ id: 'consultorio', nombre: 'Consultorio', conteos: { Patient: 40 }, links: ['umls'] }),
        base({
          id: 'umls',
          nombre: 'umls',
          conteos: { CodeSystem: 3, ValueSet: 2 },
          valueSets: VS,
          exporta: ['CodeSystem', 'ValueSet', 'ConceptMap'],
        }),
      ],
      []
    );
    expect(h.some((x) => x.nivel === 'ok' && x.texto.includes('llega por link'))).toBe(true);
    expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('terminología'))).toBe(false);
  });

  test('linkear sin exportar CodeSystem/ValueSet es un problema, no un ok', () => {
    const h = analizar(
      [
        base({ id: 'consultorio', nombre: 'Consultorio', conteos: { Patient: 40 }, links: ['umls'] }),
        base({
          id: 'umls',
          nombre: 'umls',
          conteos: { CodeSystem: 3, ValueSet: 2 },
          valueSets: VS,
          exporta: ['ConceptMap'],
        }),
      ],
      []
    );
    expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('no exporta CodeSystem y ValueSet'))).toBe(true);
  });

  test('terminología en otro proyecto SIN link: el buscador no la ve', () => {
    const h = analizar(
      [
        base({ id: 'consultorio', nombre: 'Consultorio', conteos: { Patient: 40 } }),
        base({
          id: 'umls',
          nombre: 'umls',
          conteos: { CodeSystem: 3, ValueSet: 2 },
          valueSets: VS,
          exporta: ['CodeSystem'],
        }),
      ],
      []
    );
    expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('no la ve: falta'))).toBe(true);
  });
  // Con varios consultorios en el mismo servidor, "el que más pacientes tiene"
  // dejó de ser "el que me interesa" — y un proyecto marcado superAdmin ni
  // siquiera entraba al análisis.
  describe('Veredicto enfocado en un proyecto', () => {
    const server = [
      base({ id: 'bw', nombre: 'Biowellness | San Isidro', conteos: { Patient: 39 }, bots: [bot('ckm-recalculate')] }),
      base({
        id: 'fav',
        nombre: 'Favaloro | Medplum Argentina',
        superAdmin: true,
        conteos: { Patient: 7 },
        bots: [],
      }),
    ];

    test('sin objetivo elige el de más pacientes y avisa que hay más', () => {
      const h = analizar(server, []);
      expect(h[0].texto).toContain('Biowellness');
      expect(h.some((x) => x.texto.includes('--proyecto='))).toBe(true);
    });

    test('con --proyecto el veredicto es sobre ESE proyecto, aunque sea superAdmin', () => {
      const h = analizar(server, ['ckm-recalculate'], 'fav');
      expect(h[0].texto).toContain('Favaloro');
      // Y ahí sí reporta lo que le falta a ese proyecto, no al otro.
      expect(h.some((x) => x.nivel === 'problema' && x.texto.includes('Faltan en «Favaloro'))).toBe(true);
    });

    test('acepta el nombre además del id', () => {
      expect(analizar(server, [], 'Favaloro | Medplum Argentina')[0].texto).toContain('Favaloro');
    });

    test('un objetivo inexistente lo dice, no elige otro por las dudas', () => {
      const h = analizar(server, [], 'no-existe');
      expect(h).toHaveLength(1);
      expect(h[0].nivel).toBe('problema');
      expect(h[0].texto).toContain('no-existe');
    });

    test('avisa cuando hay más de un proyecto con superAdmin', () => {
      const h = analizar([...server, base({ id: 'sa', nombre: 'Super Admin', superAdmin: true })], [], 'bw');
      expect(h.some((x) => x.nivel === 'aviso' && x.texto.includes('poderes sobre todo el servidor'))).toBe(true);
    });
  });
});

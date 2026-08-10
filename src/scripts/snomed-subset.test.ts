import {
  candidatoUnico,
  clasificar,
  etiquetaSemantica,
  matcheaDci,
  normalizar,
  parseDescripcion,
} from './snomed-subset';
import type { Candidato } from './snomed-subset';

describe('Normalización de términos', () => {
  test('minúsculas, sin diacríticos, espacios colapsados', () => {
    expect(normalizar('  Ácidos   Grasos Omega-3 ')).toBe('acidos grasos omega-3');
  });
});

describe('Parseo de la fila RF2 de Description', () => {
  const FILA = '123\t20240501\t1\t900101001\t109081006\tes\t900000000000013009\tmetformina\t900000000000448009';

  test('extrae active, conceptId, typeId y term', () => {
    expect(parseDescripcion(FILA)).toStrictEqual({
      active: true,
      conceptId: '109081006',
      typeId: '900000000000013009',
      term: 'metformina',
    });
  });

  test('descarta el encabezado y las filas cortas', () => {
    expect(
      parseDescripcion('id\teffectiveTime\tactive\tmoduleId\tconceptId\tlang\ttypeId\tterm\tcase')
    ).toBeUndefined();
    expect(parseDescripcion('truncada\t1')).toBeUndefined();
  });
});

describe('Matcheo de DCI', () => {
  test('el nombre pelado matchea', () => {
    expect(matcheaDci('Metformina', 'metformina')).toBe(true);
  });

  test('el patrón "producto que contiene" matchea, con y sin etiqueta', () => {
    expect(matcheaDci('producto que contiene metformina (producto medicinal)', 'metformina')).toBe(true);
    expect(matcheaDci('producto que contiene metformina', 'metformina')).toBe(true);
    expect(matcheaDci('producto medicinal que contiene metformina', 'metformina')).toBe(true);
  });

  // El peligro real: la DCI como prefijo de una combinación. Prescribir la
  // combinación cuando se quería el monofármaco es un error clínico.
  test('las combinaciones NO matchean', () => {
    expect(matcheaDci('producto que contiene metformina y glibenclamida (producto medicinal)', 'metformina')).toBe(
      false
    );
    expect(matcheaDci('metformina y glibenclamida', 'metformina')).toBe(false);
  });

  test('un término ajeno no matchea', () => {
    expect(matcheaDci('metforminum aliud', 'metformina')).toBe(false);
  });
});

describe('Clasificación por etiqueta semántica del FSN', () => {
  test('extrae la etiqueta de los últimos paréntesis', () => {
    expect(etiquetaSemantica('producto que contiene metformina (producto medicinal)')).toBe('producto medicinal');
  });

  test('producto medicinal en español y en inglés', () => {
    expect(clasificar('producto que contiene metformina (producto medicinal)')).toBe('producto-medicinal');
    expect(clasificar('product containing metformin (medicinal product)')).toBe('producto-medicinal');
  });

  // La sustancia es el químico, no lo que se prescribe: se muestra pero nunca
  // se aplica sola.
  test('sustancia y producto clínico no son lo prescribible a nivel DCI', () => {
    expect(clasificar('metformina (sustancia)')).toBe('sustancia');
    expect(clasificar('metformin (substance)')).toBe('sustancia');
    expect(clasificar('metformina 500 mg comprimido (producto medicinal clínico)')).toBe('producto-clinico');
  });

  test('sin FSN o sin etiqueta, la clase es otro', () => {
    expect(clasificar(undefined)).toBe('otro');
    expect(clasificar('un termino sin parentesis')).toBe('otro');
  });
});

describe('Selección del candidato aplicable', () => {
  const producto = (id: string): Candidato => ({
    conceptId: id,
    fsn: `producto que contiene x (producto medicinal)`,
    clase: 'producto-medicinal',
    terminoMatcheado: 'x',
  });
  const sustancia: Candidato = { conceptId: 's1', fsn: 'x (sustancia)', clase: 'sustancia', terminoMatcheado: 'x' };

  test('un único producto medicinal se aplica, la sustancia no interfiere', () => {
    expect(candidatoUnico([sustancia, producto('p1')])?.conceptId).toBe('p1');
  });

  // Ante ambigüedad no se aplica nada: elegir mal un código y que parezca
  // verificado es exactamente lo que este script existe para impedir.
  test('dos productos medicinales -> nada automático', () => {
    expect(candidatoUnico([producto('p1'), producto('p2')])).toBeUndefined();
  });

  test('solo sustancia -> nada automático', () => {
    expect(candidatoUnico([sustancia])).toBeUndefined();
  });
});

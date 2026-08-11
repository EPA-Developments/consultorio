import { claseDeRefset, displaySinTag, enLotes, parseMiembroSimple, REFSET_MARCAS } from './snomed-vademecum';

describe('Parseo de miembros de refset simple', () => {
  // Fila real del formato: id, effectiveTime, active, moduleId, refsetId, referencedComponentId
  const FILA = 'abc-123\t20260520\t1\t11000221109\t574461000221103\t579341000221106';

  test('extrae active, refsetId y conceptId', () => {
    expect(parseMiembroSimple(FILA)).toStrictEqual({
      active: true,
      refsetId: '574461000221103',
      conceptId: '579341000221106',
    });
  });

  test('descarta encabezado y filas cortas', () => {
    expect(parseMiembroSimple('id\teffectiveTime\tactive\tmoduleId\trefsetId\treferencedComponentId')).toBeUndefined();
    expect(parseMiembroSimple('corta\t1')).toBeUndefined();
  });
});

describe('Clase por refset', () => {
  test('marcas, genéricos y diagnósticos del recorte; el resto no entra', () => {
    expect(claseDeRefset(REFSET_MARCAS)).toBe('marca');
    expect(claseDeRefset('574471000221107')).toBe('generico');
    expect(claseDeRefset('574481000221105')).toBe('generico');
    // Diagnósticos del Programa SUMAR: el índice del campo diagnóstico.
    expect(claseDeRefset('371191000221103')).toBe('diagnostico');
    // Prácticas de laboratorio: valioso, pero no es este recorte.
    expect(claseDeRefset('537301000221103')).toBeUndefined();
  });
});

describe('Display del concepto', () => {
  test('el FSN pierde solo su etiqueta semántica final', () => {
    expect(displaySinTag('CRESTOR [ROSUVASTATINA 10 MG] COMPRIMIDO RECUBIERTO (fármaco de uso clínico comercial)')).toBe(
      'CRESTOR [ROSUVASTATINA 10 MG] COMPRIMIDO RECUBIERTO'
    );
    // Los paréntesis internos (sales) quedan intactos.
    expect(displaySinTag('X [A (COMO B) 10 MG] COMP (fármaco de uso clínico comercial)')).toBe(
      'X [A (COMO B) 10 MG] COMP'
    );
  });
});

describe('Lotes del $import', () => {
  test('parte sin perder ni repetir', () => {
    const lotes = enLotes([1, 2, 3, 4, 5], 2);
    expect(lotes).toStrictEqual([[1, 2], [3, 4], [5]]);
  });
});

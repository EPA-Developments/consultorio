import { itemDesdeVademecum, parseDisplayMarca } from './vademecum';

describe('Parseo del display del vademécum', () => {
  // Displays reales de la importación 20260520 (prueba de humo del servidor).
  test('una marca llena DCI + presentación y deja la marca como sugerida, SIN snomedId', () => {
    const item = itemDesdeVademecum({
      code: '123951000221103',
      display: 'CRESTOR [ROSUVASTATINA 10 MG] COMPRIMIDO RECUBIERTO',
    });
    expect(item).toStrictEqual({
      dci: 'rosuvastatina',
      presentacion: 'comprimido recubierto 10 mg',
      marcaSugerida: 'CRESTOR',
      // Codificar con el concepto de la marca sería prescribir la marca:
      // el snomedId queda ausente a propósito.
    });
    expect(item.snomedId).toBeUndefined();
  });

  test('la sal inline queda en la DCI (nombre genérico + sal es legal)', () => {
    const item = itemDesdeVademecum({
      code: 'x',
      display: 'LIPOGLUTAREN DUO [ROSUVASTATINA CALCICA 10 MG] COMPRIMIDO RECUBIERTO',
    });
    expect(item.dci).toBe('rosuvastatina calcica');
    expect(item.marcaSugerida).toBe('LIPOGLUTAREN DUO');
  });

  test('un genérico lleva su conceptId como coding y la forma como presentación', () => {
    const item = itemDesdeVademecum({
      code: '765550003',
      display:
        'producto que contiene exactamente clorhidrato de metformina 1 gramo por cada comprimido oral de liberación convencional',
    });
    expect(item).toStrictEqual({
      dci: 'clorhidrato de metformina 1 gramo',
      presentacion: 'comprimido oral de liberación convencional',
      snomedId: '765550003',
    });
  });

  test('un display que no matchea ningún patrón va como texto a la DCI, sin inventar', () => {
    expect(itemDesdeVademecum({ code: 'x', display: 'algo inesperado' })).toStrictEqual({ dci: 'algo inesperado' });
  });

  test('parseDisplayMarca exige marca y composición no vacías', () => {
    expect(parseDisplayMarca('[SOLO COMPO] FORMA')).toBeUndefined();
    expect(parseDisplayMarca('MARCA [] FORMA')).toBeUndefined();
    expect(parseDisplayMarca('producto que contiene metformina')).toBeUndefined();
  });
});

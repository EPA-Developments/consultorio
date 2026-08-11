import { medicamentosDelCatalogo } from './catalogo';
import { marcasDelCatalogo, opcionesDeMarca } from './marcas';

describe('Catálogo de marcas del DNM', () => {
  const dcisDelCatalogo = new Set(medicamentosDelCatalogo().map((m) => m.dci));

  test('toda marca tiene sus campos y apunta a una DCI del catálogo de medicamentos', () => {
    for (const m of marcasDelCatalogo()) {
      expect(m.marca.trim()).toBeTruthy();
      expect(m.conceptId.trim()).toBeTruthy();
      expect(m.presentacion.trim()).toBeTruthy();
      expect(dcisDelCatalogo.has(m.dci), `${m.marca} → ${m.dci}`).toBe(true);
    }
  });

  test('los conceptId no se repiten', () => {
    const ids = marcasDelCatalogo().map((m) => m.conceptId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // El caso que motivó todo: el médico piensa la marca, la receta lleva la DCI.
  test('CRESTOR encuentra a rosuvastatina', () => {
    const crestor = marcasDelCatalogo().filter((m) => m.marca === 'CRESTOR');
    expect(crestor.length).toBeGreaterThan(0);
    expect(crestor.every((m) => m.dci === 'rosuvastatina')).toBe(true);
  });

  test('las opciones del buscador son únicas por marca+DCI y vienen ordenadas', () => {
    const opciones = opcionesDeMarca();
    const etiquetas = opciones.map((o) => o.etiqueta);
    expect(new Set(etiquetas).size).toBe(etiquetas.length);
    expect(etiquetas).toStrictEqual([...etiquetas].sort((a, b) => a.localeCompare(b)));
    // Menos opciones que presentaciones: el dedupe hace su trabajo.
    expect(opciones.length).toBeLessThan(marcasDelCatalogo().length);
  });

  // Un kit multiempaque es una opción POR COMPONENTE: buscarlo muestra todos
  // sus DCIs, y se prescriben todos.
  test('los kits multiempaque aparecen una vez por componente', () => {
    const artomeyDuo = opcionesDeMarca().filter((o) => o.marca === 'ARTOMEY DUO');
    expect(new Set(artomeyDuo.map((o) => o.dci)).size).toBeGreaterThan(1);
  });
});

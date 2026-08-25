import { BOTS, nombreDeBot, nombreLegadoDeBot, identidadDeBot, PREFIJO_BOTS } from './bot-names';

// El prefijo no es cosmético: sin él, `Bot?name=ckm-recalculate` lanzado desde
// Favaloro resuelve también los bots de los proyectos linkeados (Biowellness).
describe('Nombres de los bots', () => {
  test('prefijo de proyecto + módulo', () => {
    expect(nombreDeBot('src/bots/ckm/sdoh-response.ts')).toBe('favaloro-ckm-sdoh-response');
    expect(nombreDeBot('src/bots/refeps/refeps-verify.ts')).toBe('favaloro-refeps-verify');
  });

  // favaloro-ckm-ckm-alerts sería feo y, peor, distinto del que quedó escrito
  // en las Subscriptions.
  test('no repite el módulo cuando el archivo ya lo lleva', () => {
    expect(nombreDeBot('src/bots/ckm/ckm-alerts.ts')).toBe('favaloro-ckm-alerts');
    expect(nombreDeBot('src/bots/ckm/ckm-recalculate.ts')).toBe('favaloro-ckm-recalculate');
  });

  test('el nombre legado es el del archivo, sin prefijo', () => {
    expect(nombreLegadoDeBot('src/bots/ckm/careplan-generate.ts')).toBe('careplan-generate');
  });

  test('todos los bots del repo llevan el prefijo y ninguno se repite', () => {
    expect(BOTS.every((b) => b.nombre.startsWith(PREFIJO_BOTS))).toBe(true);
    expect(new Set(BOTS.map((b) => b.nombre)).size).toBe(BOTS.length);
    expect(new Set(BOTS.map((b) => b.legado)).size).toBe(BOTS.length);
  });

  // Si alguien agrega un bot al bundle sin darle identidad, el build falla acá
  // y no en producción con un bot desplegado sin prefijo.
  test('pedir la identidad de un bot que no está en la tabla es un error', () => {
    expect(() => identidadDeBot('src/bots/ckm/inexistente.ts')).toThrow(/no está en la tabla/);
  });
});

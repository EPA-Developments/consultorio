import { CODE39_PATRONES, code39Svg } from './barcode';

describe('Tabla Code 39', () => {
  // "3 de 9": nueve elementos por carácter, exactamente tres anchos, de los
  // cuales dos son barras (posiciones impares) y uno es espacio. Un patrón
  // que rompa esto imprime un código ilegible o, peor, uno que lee otra cosa.
  test('todo patrón cumple los invariantes estructurales del estándar', () => {
    for (const [ch, patron] of Object.entries(CODE39_PATRONES)) {
      expect(patron, ch).toHaveLength(9);
      const anchos = [...patron].map((c, i) => ({ c, esBarra: i % 2 === 0 })).filter((e) => e.c === 'w');
      expect(anchos, ch).toHaveLength(3);
      expect(anchos.filter((e) => e.esBarra), ch).toHaveLength(2);
      expect(anchos.filter((e) => !e.esBarra), ch).toHaveLength(1);
    }
  });

  test('los patrones son únicos (dos caracteres no pueden compartir barras)', () => {
    const patrones = Object.values(CODE39_PATRONES);
    expect(new Set(patrones).size).toBe(patrones.length);
  });
});

describe('SVG del código', () => {
  test('una matrícula real genera sus barras: 5 por carácter, con inicio y fin', () => {
    const svg = code39Svg('MN-92179');
    expect(svg).toBeDefined();
    // 8 caracteres + '*' de inicio y fin = 10, cada uno con 5 barras.
    expect(svg?.match(/<rect/g)).toHaveLength(50);
  });

  test('minúsculas se normalizan y lo ajeno al alfabeto se descarta', () => {
    expect(code39Svg('rec-7dcc')).toBe(code39Svg('REC-7DCC'));
    expect(code39Svg('MN*92179')).toBe(code39Svg('MN92179'));
  });

  test('sin contenido codificable no hay código', () => {
    expect(code39Svg('')).toBeUndefined();
    expect(code39Svg('ñ@#')).toBeUndefined();
  });
});

// Código de barras Code 39 como SVG autocontenido, para el documento impreso.
//
// Por qué Code 39: alfabeto suficiente (A-Z, 0-9, guión, punto, espacio) para
// matrículas ("MN-92179") y números de receta ("REC-7DCC523B"), y estructura
// simple ("3 de 9": nueve elementos por carácter, exactamente tres anchos) que
// se puede generar y VERIFICAR sin ninguna librería externa — el HTML de
// impresión es autocontenido a propósito.
//
// La tabla cumple los invariantes estructurales del estándar y los tests los
// verifican carácter por carácter (largo 9, tres anchos: dos barras y un
// espacio). Además el documento siempre imprime el valor en texto legible al
// pie de las barras: si un lector no lo toma, el humano sí.

/** Patrones Code 39: 9 elementos alternando barra/espacio, empezando por barra. */
export const CODE39_PATRONES: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  '*': 'nwnnwnwnn',
};

const ANCHO_ANGOSTO = 1;
const ANCHO_ANCHO = 3;
const SEPARACION = 1;

/** Una barra del código: posición y ancho en unidades del patrón. */
export interface Code39Bar {
  x: number;
  width: number;
}

/** Geometría del código de barras, sin decidir en qué se dibuja. */
export interface Code39Geometry {
  /** El texto efectivamente codificado (mayúsculas, sin caracteres inválidos). */
  texto: string;
  bars: Code39Bar[];
  anchoTotal: number;
}

/**
 * Geometría pura del Code 39 para un valor: las barras negras y el ancho total,
 * en unidades del patrón. Los caracteres fuera del alfabeto se descartan
 * (mayúsculas primero); si no queda nada, no hay código.
 *
 * Vive separada del render porque el mismo código se dibuja de dos maneras:
 * como `<rect>` en el SVG del HTML de impresión y como rectángulos en el PDF
 * que se firma. Una sola geometría, dos salidas — que diverjan sería que el
 * documento impreso y el firmado tengan códigos distintos.
 */
export function code39Geometry(valor: string): Code39Geometry | undefined {
  const texto = valor.toUpperCase().replace(/[^A-Z0-9 .-]/g, '');
  if (!texto) {
    return undefined;
  }
  const bars: Code39Bar[] = [];
  let x = 0;
  for (const ch of `*${texto}*`) {
    const patron = CODE39_PATRONES[ch];
    for (let i = 0; i < patron.length; i++) {
      const width = patron[i] === 'w' ? ANCHO_ANCHO : ANCHO_ANGOSTO;
      if (i % 2 === 0) {
        bars.push({ x, width });
      }
      x += width;
    }
    x += SEPARACION;
  }
  return { texto, bars, anchoTotal: x - SEPARACION };
}

/**
 * SVG del código de barras Code 39 para un valor. Los caracteres fuera del
 * alfabeto se descartan (mayúsculas primero); si no queda nada, no hay código.
 */
export function code39Svg(valor: string, alto: number = 34): string | undefined {
  const geo = code39Geometry(valor);
  if (!geo) {
    return undefined;
  }
  const rects = geo.bars.map((b) => `<rect x="${b.x}" y="0" width="${b.width}" height="${alto}"/>`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${geo.anchoTotal}" height="${alto}" ` +
    `viewBox="0 0 ${geo.anchoTotal} ${alto}" preserveAspectRatio="none" shape-rendering="crispEdges" ` +
    `fill="#111" role="img" aria-label="${geo.texto}">${rects.join('')}</svg>`
  );
}

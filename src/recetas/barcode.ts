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

/**
 * SVG del código de barras Code 39 para un valor. Los caracteres fuera del
 * alfabeto se descartan (mayúsculas primero); si no queda nada, no hay código.
 */
export function code39Svg(valor: string, alto: number = 34): string | undefined {
  const texto = valor.toUpperCase().replace(/[^A-Z0-9 .-]/g, '');
  if (!texto) {
    return undefined;
  }
  const completo = `*${texto}*`;
  const rects: string[] = [];
  let x = 0;
  for (const ch of completo) {
    const patron = CODE39_PATRONES[ch];
    for (let i = 0; i < patron.length; i++) {
      const ancho = patron[i] === 'w' ? ANCHO_ANCHO : ANCHO_ANGOSTO;
      if (i % 2 === 0) {
        rects.push(`<rect x="${x}" y="0" width="${ancho}" height="${alto}"/>`);
      }
      x += ancho;
    }
    x += SEPARACION;
  }
  const anchoTotal = x - SEPARACION;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${anchoTotal}" height="${alto}" ` +
    `viewBox="0 0 ${anchoTotal} ${alto}" preserveAspectRatio="none" shape-rendering="crispEdges" ` +
    `fill="#111" role="img" aria-label="${texto}">${rects.join('')}</svg>`
  );
}

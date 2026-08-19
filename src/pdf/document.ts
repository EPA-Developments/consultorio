// Documento PDF: primitivas compartidas de maqueta y dibujo.
//
// Por qué existe esto y no alcanza con "Guardar como PDF" del navegador: el PDF
// de una receta se sube a firmar.gob.ar para firmarlo digitalmente, y el PDF que
// produce el diálogo de impresión NO sirve para eso. No lo vemos nunca (los
// bytes quedan del lado del usuario), y no es reproducible: cambia con el
// navegador, los márgenes, el tamaño de papel y los encabezados que el usuario
// tenga activados — de hecho el navegador le inyecta la URL de la página al pie.
// Un documento que se firma tiene que ser determinista: los mismos datos, los
// mismos bytes, siempre.
//
// La maqueta se expresa como DATOS (bloques con posición) y se dibuja aparte.
// Esa costura es la que permite testear el documento sin abrir un PDF: las
// posiciones y los textos se verifican como cualquier estructura.
//
// Coordenadas: y se mide DESDE ARRIBA, como se piensa un documento. El
// renderer las convierte al sistema de PDF (origen abajo a la izquierda).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { code39Geometry } from '../recetas/barcode';

/** Roles de color, para no repartir hex por la maqueta. */
export type PdfColor = 'ink' | 'muted' | 'soft' | 'accent' | 'rule' | 'panel';

const COLORS: Record<PdfColor, ReturnType<typeof rgb>> = {
  ink: rgb(0.102, 0.102, 0.102), // #1a1a1a
  muted: rgb(0.4, 0.4, 0.4), // #666
  soft: rgb(0.6, 0.6, 0.6), // #999
  accent: rgb(0.541, 0.29, 0.141), // #8a4a24
  rule: rgb(0.69, 0.416, 0.231), // #b06a3b
  panel: rgb(0.969, 0.957, 0.945), // #f7f4f1
};

export type PdfAlign = 'left' | 'right' | 'center';

export interface PdfText {
  kind: 'text';
  text: string;
  /** Ancla horizontal: borde izquierdo, derecho o centro según `align`. */
  x: number;
  /** Distancia desde el borde SUPERIOR de la página a la línea de base. */
  y: number;
  size: number;
  bold?: boolean;
  color?: PdfColor;
  align?: PdfAlign;
}

export interface PdfBarcode {
  kind: 'barcode';
  value: string;
  x: number;
  y: number;
  /** Ancho máximo; las barras se escalan para entrar. */
  width: number;
  height: number;
  align?: PdfAlign;
}

export interface PdfRule {
  kind: 'rule';
  x: number;
  y: number;
  width: number;
  thickness?: number;
  color?: PdfColor;
  dashed?: boolean;
}

export interface PdfPanel {
  kind: 'panel';
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfBlock = PdfText | PdfBarcode | PdfRule | PdfPanel;

/** Mide un texto. La inyecta el renderer (las métricas viven en la fuente). */
export type Measure = (text: string, size: number, bold: boolean) => number;

/** Metadatos del documento. `date` fija las fechas: sin eso el PDF no es reproducible. */
export interface PdfMeta {
  title: string;
  author?: string;
  subject?: string;
  creator: string;
  /** Fecha de creación y modificación. Debe derivar del contenido, no del reloj. */
  date: Date;
}

// ── A4 en puntos ────────────────────────────────────────────────────────────
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
/** 16 mm, el mismo margen que declara @page en el HTML de impresión. */
export const MARGIN = 45.35;
export const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

/**
 * Corta un texto en líneas que entran en `maxWidth`. Las palabras más largas
 * que el ancho se dejan enteras: partir un nombre de droga al medio sería peor
 * que pasarse unos puntos.
 */
export function wrapText(text: string, maxWidth: number, size: number, bold: boolean, measure: Measure): string[] {
  const palabras = text.split(/\s+/).filter(Boolean);
  if (palabras.length === 0) {
    return [];
  }
  const lineas: string[] = [];
  let actual = palabras[0];
  for (const palabra of palabras.slice(1)) {
    const tentativa = `${actual} ${palabra}`;
    if (measure(tentativa, size, bold) <= maxWidth) {
      actual = tentativa;
    } else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  lineas.push(actual);
  return lineas;
}

/**
 * Deja el texto en el subconjunto que las fuentes estándar (WinAnsi) pueden
 * escribir. Sin esto, un carácter fuera de rango hace que pdf-lib TIRE al
 * dibujar y la receta no sale — preferimos un guion en vez de una raya antes
 * que un documento que no se genera.
 */
export function toWinAnsi(text: string): string {
  const reemplazos: Record<string, string> = {
    '—': '-',
    '–': '-',
    '‘': "'",
    '’': "'",
    '“': '"',
    '”': '"',
    '…': '...',
    ' ': ' ',
  };
  return [...text]
    .map((ch) => reemplazos[ch] ?? ch)
    .map((ch) => (ch.codePointAt(0) ?? 0) <= 0xff || ch === '€' ? ch : '?')
    .join('');
}

/**
 * Dibuja los bloques y devuelve los bytes del PDF.
 *
 * Determinismo: las fechas salen de `meta.date` (no del reloj) y no se embebe
 * ninguna fuente externa — con las estándar el resultado depende solo de los
 * datos. Los mismos datos producen el mismo archivo, que es lo que permite
 * verificar después que el PDF firmado es el que emitimos.
 */
export async function renderPdf(
  build: (measure: Measure) => PdfBlock[],
  meta: PdfMeta
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fuente = (esBold: boolean): PDFFont => (esBold ? bold : regular);

  const measure: Measure = (text, size, esBold) => fuente(esBold).widthOfTextAtSize(toWinAnsi(text), size);
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);

  for (const block of build(measure)) {
    drawBlock(page, block, fuente, measure);
  }

  doc.setTitle(toWinAnsi(meta.title));
  doc.setCreator(toWinAnsi(meta.creator));
  doc.setProducer(toWinAnsi(meta.creator));
  if (meta.author) {
    doc.setAuthor(toWinAnsi(meta.author));
  }
  if (meta.subject) {
    doc.setSubject(toWinAnsi(meta.subject));
  }
  doc.setCreationDate(meta.date);
  doc.setModificationDate(meta.date);

  return doc.save({ useObjectStreams: false });
}

function drawBlock(page: PDFPage, block: PdfBlock, fuente: (b: boolean) => PDFFont, measure: Measure): void {
  const top = (y: number): number => A4_HEIGHT - y;

  switch (block.kind) {
    case 'panel':
      page.drawRectangle({
        x: block.x,
        y: top(block.y + block.height),
        width: block.width,
        height: block.height,
        color: COLORS.panel,
      });
      return;

    case 'rule':
      page.drawLine({
        start: { x: block.x, y: top(block.y) },
        end: { x: block.x + block.width, y: top(block.y) },
        thickness: block.thickness ?? 0.6,
        color: COLORS[block.color ?? 'rule'],
        ...(block.dashed ? { dashArray: [2, 2] } : {}),
      });
      return;

    case 'text': {
      const texto = toWinAnsi(block.text);
      const esBold = block.bold ?? false;
      const ancho = measure(block.text, block.size, esBold);
      page.drawText(texto, {
        x: alinear(block.x, ancho, block.align),
        y: top(block.y),
        size: block.size,
        font: fuente(esBold),
        color: COLORS[block.color ?? 'ink'],
      });
      return;
    }

    case 'barcode': {
      const geo = code39Geometry(block.value);
      if (!geo) {
        return;
      }
      // Las barras vienen en unidades del patrón: se escalan para entrar en el
      // ancho pedido sin deformar las proporciones entre barra angosta y ancha.
      const escala = block.width / geo.anchoTotal;
      const x0 = alinear(block.x, block.width, block.align);
      for (const bar of geo.bars) {
        page.drawRectangle({
          x: x0 + bar.x * escala,
          y: top(block.y + block.height),
          width: bar.width * escala,
          height: block.height,
          color: COLORS.ink,
        });
      }
      return;
    }
  }
}

function alinear(x: number, ancho: number, align: PdfAlign | undefined): number {
  if (align === 'right') {
    return x - ancho;
  }
  if (align === 'center') {
    return x - ancho / 2;
  }
  return x;
}

/**
 * Ofrece el PDF como descarga. Es la única parte que toca el DOM: todo lo demás
 * de este módulo es puro y testeable.
 *
 * El archivo que baja acá es el que se sube a firmar.gob.ar; por eso el nombre
 * importa y se pasa desde afuera.
 */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Liberar en el próximo tick: revocar antes puede cancelar la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

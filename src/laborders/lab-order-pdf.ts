// PDF de la orden de laboratorio: el archivo que se firma.
//
// Mismo diseño que receta-pdf, con el objeto cambiado. La diferencia de forma:
// una orden es una TABLA de estudios con su código, no bloques Rp/.
//
// Comparte los DATOS con la impresión HTML (LabOrderPrintData), no el render:
// el contenido no puede divergir entre lo que se ve en pantalla y lo que se
// firma. Y comparte el generador con la receta (src/pdf/document.ts), así que
// los dos documentos salen deterministas por la misma razón — los mismos
// datos, los mismos bytes, que es lo que después permite verificar el firmado.
import { brandTitle } from '../brand';
import { CONTENT_WIDTH, MARGIN, renderPdf, wrapText } from '../pdf/document';
import type { Measure, PdfBlock, PdfMeta } from '../pdf/document';
import { EMISSION_STATUS } from './lab-order-emission';
import type { LabOrderPrintData } from './lab-order-print';

/** Tamaños en puntos (los px del HTML a 0.75). */
const SIZE = {
  clinic: 15,
  subtitle: 9,
  docTitle: 11.25,
  orderId: 10.5,
  body: 9.75,
  small: 9,
  verify: 8.25,
  disclaimer: 7.9,
} as const;

const RIGHT = MARGIN + CONTENT_WIDTH;
/** Columnas de la tabla de estudios: #, estudio, código. */
const COL_NUM = MARGIN + 4;
const COL_ESTUDIO = MARGIN + 26;
const COL_CODIGO = RIGHT - 4;

export function buildLabOrderPdfBlocks(data: LabOrderPrintData, measure: Measure): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  let y = MARGIN + SIZE.clinic;

  // ── Encabezado ────────────────────────────────────────────────────────────
  blocks.push({ kind: 'text', text: data.clinicName, x: MARGIN, y, size: SIZE.clinic, bold: true, color: 'accent' });
  blocks.push({
    kind: 'text',
    text: 'ORDEN DE LABORATORIO',
    x: RIGHT,
    y,
    size: SIZE.docTitle,
    bold: true,
    align: 'right',
  });
  y += 13;
  if (data.clinicSubtitle) {
    blocks.push({ kind: 'text', text: data.clinicSubtitle, x: MARGIN, y, size: SIZE.subtitle, color: 'muted' });
  }
  blocks.push({ kind: 'text', text: data.requisitionId, x: RIGHT, y, size: SIZE.orderId, bold: true, align: 'right' });
  y += 12;
  blocks.push({
    kind: 'text',
    text: fmtDate(data.authoredOn),
    x: RIGHT,
    y,
    size: SIZE.small,
    color: 'muted',
    align: 'right',
  });

  y += 6;
  blocks.push({ kind: 'barcode', value: data.requisitionId, x: RIGHT, y, width: 150, height: 22, align: 'right' });
  y += 22 + 9;
  blocks.push({ kind: 'text', text: data.requisitionId, x: RIGHT, y, size: 7, color: 'muted', align: 'right' });

  y += 10;
  blocks.push({ kind: 'rule', x: MARGIN, y, width: CONTENT_WIDTH, thickness: 1.4, color: 'rule' });

  // Una propuesta del paciente NO es una orden médica: el papel lo dice antes
  // que nada, porque es lo que decide si un laboratorio puede atenderla.
  if (data.intent === 'proposal') {
    y += 16;
    blocks.push({ kind: 'panel', x: MARGIN, y, width: CONTENT_WIDTH, height: 20 });
    blocks.push({
      kind: 'text',
      text: 'Solicitud generada por el paciente. Requiere revisión y emisión del médico.',
      x: MARGIN + 12,
      y: y + 14,
      size: SIZE.small,
      bold: true,
      color: 'accent',
    });
    y += 20;
  }

  // ── Paciente ──────────────────────────────────────────────────────────────
  const filas = filasPaciente(data);
  const panelAlto = Math.ceil(filas.length / 2) * 13 + 14;
  y += 12;
  blocks.push({ kind: 'panel', x: MARGIN, y, width: CONTENT_WIDTH, height: panelAlto });
  let filaY = y + 17;
  filas.forEach((fila, i) => {
    const columna = i % 2;
    const x = MARGIN + 12 + columna * (CONTENT_WIDTH / 2);
    blocks.push({ kind: 'text', text: `${fila.k}:`, x, y: filaY, size: SIZE.small, color: 'muted' });
    blocks.push({
      kind: 'text',
      text: fila.v,
      x: x + measure(`${fila.k}: `, SIZE.small, false),
      y: filaY,
      size: SIZE.small,
      bold: true,
    });
    if (columna === 1 || i === filas.length - 1) {
      filaY += 13;
    }
  });
  y += panelAlto;

  // ── Tabla de estudios ─────────────────────────────────────────────────────
  y += 24;
  blocks.push({ kind: 'text', text: '#', x: COL_NUM, y, size: 7.5, bold: true, color: 'muted' });
  blocks.push({ kind: 'text', text: 'ESTUDIO SOLICITADO', x: COL_ESTUDIO, y, size: 7.5, bold: true, color: 'muted' });
  blocks.push({ kind: 'text', text: 'CÓDIGO', x: COL_CODIGO, y, size: 7.5, bold: true, color: 'muted', align: 'right' });
  y += 4;
  blocks.push({ kind: 'rule', x: MARGIN, y, width: CONTENT_WIDTH, thickness: 0.6, color: 'muted' });

  const anchoEstudio = COL_CODIGO - COL_ESTUDIO - 60;
  data.items.forEach((item, i) => {
    y += 14;
    blocks.push({ kind: 'text', text: `${i + 1}`, x: COL_NUM, y, size: SIZE.body, color: 'soft' });
    const lineas = wrapText(item.label, anchoEstudio, SIZE.body, false, measure);
    lineas.forEach((linea, j) => {
      blocks.push({ kind: 'text', text: linea, x: COL_ESTUDIO, y: y + j * 11, size: SIZE.body });
    });
    if (item.code) {
      blocks.push({
        kind: 'text',
        text: item.code,
        x: COL_CODIGO,
        y,
        size: SIZE.small,
        color: 'muted',
        align: 'right',
      });
    }
    y += (lineas.length - 1) * 11 + 4;
    blocks.push({ kind: 'rule', x: MARGIN, y, width: CONTENT_WIDTH, thickness: 0.3, color: 'soft' });
  });

  y += 14;
  blocks.push({
    kind: 'text',
    text: `${data.items.length} ${data.items.length === 1 ? 'estudio solicitado' : 'estudios solicitados'}`,
    x: MARGIN,
    y,
    size: SIZE.small,
    bold: true,
    color: 'muted',
  });

  // ── Diagnóstico ───────────────────────────────────────────────────────────
  y += 18;
  const dxEtiqueta = 'Diagnóstico: ';
  blocks.push({ kind: 'text', text: dxEtiqueta, x: MARGIN, y, size: SIZE.body, bold: true, color: 'muted' });
  const dxX = MARGIN + measure(dxEtiqueta, SIZE.body, true);
  if (data.diagnosis) {
    blocks.push({ kind: 'text', text: data.diagnosis, x: dxX, y, size: SIZE.body });
  } else {
    blocks.push({ kind: 'rule', x: dxX, y: y + 2, width: 240, thickness: 0.5, color: 'soft' });
  }

  if (data.fastingNote) {
    y += 16;
    const etiqueta = 'Indicaciones: ';
    blocks.push({ kind: 'text', text: etiqueta, x: MARGIN, y, size: SIZE.verify, bold: true, color: 'muted' });
    const x = MARGIN + measure(etiqueta, SIZE.verify, true);
    wrapText(data.fastingNote, RIGHT - x, SIZE.verify, false, measure).forEach((linea, j) => {
      blocks.push({ kind: 'text', text: linea, x: j === 0 ? x : MARGIN, y: y + j * 10, size: SIZE.verify, color: 'muted' });
    });
  }

  // ── Firma del profesional ─────────────────────────────────────────────────
  y += 52;
  const cajaAncho = 200;
  const cajaX = RIGHT - cajaAncho;
  blocks.push({ kind: 'rule', x: cajaX, y, width: cajaAncho, thickness: 0.8, color: 'ink' });
  y += 12;
  const centro = cajaX + cajaAncho / 2;
  blocks.push({
    kind: 'text',
    text: data.practitionerName ?? '',
    x: centro,
    y,
    size: SIZE.body,
    bold: true,
    align: 'center',
  });
  for (const linea of [
    data.practitionerMatricula ? `Matrícula ${data.practitionerMatricula}` : 'Firma y sello del profesional',
    data.practitionerSpecialty,
    data.practitionerAddress,
  ].filter((t): t is string => Boolean(t))) {
    y += 11;
    blocks.push({ kind: 'text', text: linea, x: centro, y, size: SIZE.small, color: 'muted', align: 'center' });
  }
  if (data.practitionerMatricula) {
    y += 8;
    blocks.push({
      kind: 'barcode',
      value: data.practitionerMatricula,
      x: centro,
      y,
      width: 130,
      height: 20,
      align: 'center',
    });
    y += 20 + 8;
    blocks.push({ kind: 'text', text: data.practitionerMatricula, x: centro, y, size: 7, color: 'muted', align: 'center' });
  }

  // ── Verificación ──────────────────────────────────────────────────────────
  if (data.verificationUrl && data.seal) {
    y += 22;
    blocks.push({ kind: 'panel', x: MARGIN, y, width: CONTENT_WIDTH, height: 34 });
    blocks.push({ kind: 'text', text: 'Verificación:', x: MARGIN + 12, y: y + 14, size: SIZE.verify, bold: true });
    blocks.push({
      kind: 'text',
      text: data.verificationUrl,
      x: MARGIN + 12 + measure('Verificación: ', SIZE.verify, true),
      y: y + 14,
      size: SIZE.verify,
      color: 'muted',
    });
    blocks.push({
      kind: 'text',
      text: 'Sello de integridad:',
      x: MARGIN + 12,
      y: y + 26,
      size: SIZE.verify,
      bold: true,
    });
    blocks.push({
      kind: 'text',
      text: `${data.seal.slice(0, 16)}…`,
      x: MARGIN + 12 + measure('Sello de integridad: ', SIZE.verify, true),
      y: y + 26,
      size: SIZE.verify,
      color: 'muted',
    });
    y += 34;
  }

  // ── Pie ───────────────────────────────────────────────────────────────────
  y += 24;
  blocks.push({ kind: 'rule', x: MARGIN, y, width: CONTENT_WIDTH, thickness: 0.5, color: 'soft', dashed: true });
  y += 12;
  const pie = [
    EMISSION_STATUS[data.emissionStatus ?? 'draft'].legend,
    `Generado desde ${brandTitle()}.`,
    data.registryLegend,
  ]
    .filter(Boolean)
    .join(' ');
  wrapText(pie, CONTENT_WIDTH, SIZE.disclaimer, false, measure).forEach((linea, i) => {
    blocks.push({ kind: 'text', text: linea, x: MARGIN, y: y + i * 10, size: SIZE.disclaimer, color: 'soft' });
  });

  return blocks;
}

/** Metadatos del PDF. La fecha sale de la orden: el archivo es reproducible. */
export function labOrderPdfMeta(data: LabOrderPrintData): PdfMeta {
  const fecha = new Date(data.authoredOn);
  return {
    title: `Orden de laboratorio ${data.requisitionId} — ${data.patientName}`,
    author: data.practitionerName,
    subject: 'Orden de estudios de laboratorio',
    creator: brandTitle(),
    date: Number.isNaN(fecha.getTime()) ? new Date(0) : fecha,
  };
}

/** Nombre del archivo, misma convención que la receta. */
export function labOrderPdfFilename(data: LabOrderPrintData): string {
  const paciente = data.patientName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '');
  return [`Orden-${data.requisitionId}`, paciente].filter(Boolean).join('-') + '.pdf';
}

/** Bytes del PDF de la orden. */
export async function renderLabOrderPdf(data: LabOrderPrintData): Promise<Uint8Array> {
  return renderPdf((measure) => buildLabOrderPdfBlocks(data, measure), labOrderPdfMeta(data));
}

function filasPaciente(data: LabOrderPrintData): { k: string; v: string }[] {
  return [
    { k: 'Paciente', v: data.patientName },
    data.patientBirthDate ? { k: 'Nacimiento', v: fmtDate(data.patientBirthDate) } : undefined,
    data.patientDni ? { k: 'DNI', v: data.patientDni } : undefined,
    data.patientSex ? { k: 'Sexo', v: data.patientSex } : undefined,
    data.coverage ? { k: 'Cobertura', v: data.coverage } : undefined,
  ].filter((f): f is { k: string; v: string } => Boolean(f));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-AR', { timeZone: 'UTC' });
}

// PDF de la receta: el archivo que se firma.
//
// El circuito real (confirmado con el Firmador del Estado, agosto 2026):
//   Consultorio genera el PDF  →  el profesional lo sube a firmar.gob.ar  →
//   firma con su certificado   →  descarga el PDF firmado.
// Es un portal interactivo, sin API: por eso lo que nos toca es producir un
// archivo, no integrarnos con un servicio.
//
// El documento comparte los DATOS con la impresión HTML (RecetaPrintData), no
// el render. Así el contenido no puede divergir entre lo que se ve en pantalla
// y lo que se firma; lo único distinto es la maqueta.
//
// La maqueta es pura y devuelve bloques: se puede testear posición por posición
// sin abrir un PDF.
import { brandTitle } from '../brand';
import { CONTENT_WIDTH, MARGIN, renderPdf, wrapText } from '../pdf/document';
import type { Measure, PdfBlock, PdfMeta } from '../pdf/document';
import { EMISSION_STATUS } from '../laborders/lab-order-emission';
import { cantidadEnLetras } from './receta-print';
import type { RecetaPrintData } from './receta-print';

/** Tamaños en puntos. Equivalen a los px del HTML (1px ≈ 0.75pt en impresión). */
const SIZE = {
  clinic: 15,
  subtitle: 9,
  docTitle: 11.25,
  recetaId: 10.5,
  body: 9.75,
  med: 10.5,
  small: 9,
  verify: 8.25,
  disclaimer: 7.9,
} as const;

const RIGHT = MARGIN + CONTENT_WIDTH;

/**
 * Maqueta completa de la receta, como bloques posicionados. `measure` la
 * inyecta el renderer porque las métricas viven en la fuente.
 */
export function buildRecetaPdfBlocks(data: RecetaPrintData, measure: Measure): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  let y = MARGIN + SIZE.clinic;

  // ── Encabezado ────────────────────────────────────────────────────────────
  blocks.push({ kind: 'text', text: data.clinicName, x: MARGIN, y, size: SIZE.clinic, bold: true, color: 'accent' });
  blocks.push({ kind: 'text', text: 'RECETA MÉDICA', x: RIGHT, y, size: SIZE.docTitle, bold: true, align: 'right' });
  y += 13;
  if (data.clinicSubtitle) {
    blocks.push({ kind: 'text', text: data.clinicSubtitle, x: MARGIN, y, size: SIZE.subtitle, color: 'muted' });
  }
  blocks.push({ kind: 'text', text: data.recetaId, x: RIGHT, y, size: SIZE.recetaId, bold: true, align: 'right' });
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

  // Código de barras del número de receta, arriba a la derecha.
  y += 6;
  blocks.push({ kind: 'barcode', value: data.recetaId, x: RIGHT, y, width: 150, height: 22, align: 'right' });
  y += 22 + 9;
  blocks.push({ kind: 'text', text: data.recetaId, x: RIGHT, y, size: 7, color: 'muted', align: 'right' });

  y += 10;
  blocks.push({ kind: 'rule', x: MARGIN, y, width: CONTENT_WIDTH, thickness: 1.4, color: 'rule' });

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
    const anchoEtiqueta = measure(`${fila.k}: `, SIZE.small, false);
    blocks.push({ kind: 'text', text: fila.v, x: x + anchoEtiqueta, y: filaY, size: SIZE.small, bold: true });
    if (columna === 1 || i === filas.length - 1) {
      filaY += 13;
    }
  });
  y += panelAlto;

  // ── Rp/ ───────────────────────────────────────────────────────────────────
  y += 22;
  blocks.push({ kind: 'text', text: 'Rp/', x: MARGIN, y, size: 12, bold: true, color: 'accent' });
  y += 8;

  data.items.forEach((item, i) => {
    y += 16;
    const numero = `${i + 1}.`;
    blocks.push({ kind: 'text', text: numero, x: MARGIN, y, size: SIZE.med, color: 'soft' });
    const sangria = MARGIN + 16;
    const lineas = wrapText(item.medicamento, CONTENT_WIDTH - 16 - 110, SIZE.med, true, measure);
    lineas.forEach((linea, j) => {
      blocks.push({ kind: 'text', text: linea, x: sangria, y: y + j * 12, size: SIZE.med, bold: true });
    });
    if (item.cantidad !== undefined) {
      blocks.push({
        kind: 'text',
        text: `Cantidad: ${item.cantidad} (${cantidadEnLetras(item.cantidad)})`,
        x: RIGHT,
        y,
        size: SIZE.body,
        color: 'muted',
        align: 'right',
      });
    }
    y += (lineas.length - 1) * 12;

    if (item.posologia) {
      y += 12;
      const etiqueta = 'Posología: ';
      blocks.push({ kind: 'text', text: etiqueta, x: sangria, y, size: SIZE.body, bold: true, color: 'muted' });
      const x = sangria + measure(etiqueta, SIZE.body, true);
      wrapText(item.posologia, RIGHT - x, SIZE.body, false, measure).forEach((linea, j) => {
        blocks.push({ kind: 'text', text: linea, x: j === 0 ? x : sangria, y: y + j * 11, size: SIZE.body });
      });
      y += (wrapText(item.posologia, RIGHT - x, SIZE.body, false, measure).length - 1) * 11;
    }
    if (item.nota) {
      y += 11;
      blocks.push({ kind: 'text', text: item.nota, x: sangria, y, size: SIZE.small, color: 'soft' });
    }
    y += 8;
    blocks.push({ kind: 'rule', x: MARGIN, y, width: CONTENT_WIDTH, thickness: 0.4, color: 'soft' });
  });

  // ── Diagnóstico ───────────────────────────────────────────────────────────
  y += 20;
  const dxEtiqueta = 'Diagnóstico: ';
  blocks.push({ kind: 'text', text: dxEtiqueta, x: MARGIN, y, size: SIZE.body, bold: true, color: 'muted' });
  const dxX = MARGIN + measure(dxEtiqueta, SIZE.body, true);
  if (data.diagnostico) {
    blocks.push({ kind: 'text', text: data.diagnostico, x: dxX, y, size: SIZE.body });
  } else {
    // Sin diagnóstico va la línea para completar a mano, como en el papel.
    blocks.push({ kind: 'rule', x: dxX, y: y + 2, width: 240, thickness: 0.5, color: 'soft' });
  }

  y += 18;
  blocks.push({
    kind: 'text',
    text: 'Prescripción por nombre genérico (DCI), Ley 25.649. Las marcas sugeridas pueden sustituirse.',
    x: MARGIN,
    y,
    size: SIZE.verify,
    color: 'soft',
  });

  // ── Firma del profesional ─────────────────────────────────────────────────
  y += 58;
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
    blocks.push({ kind: 'barcode', value: data.practitionerMatricula, x: centro, y, width: 130, height: 20, align: 'center' });
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
    blocks.push({ kind: 'text', text: 'Sello de integridad:', x: MARGIN + 12, y: y + 26, size: SIZE.verify, bold: true });
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

/** Metadatos del PDF. La fecha sale de la receta: el archivo es reproducible. */
export function recetaPdfMeta(data: RecetaPrintData): PdfMeta {
  const fecha = new Date(data.authoredOn);
  return {
    title: `Receta ${data.recetaId} — ${data.patientName}`,
    author: data.practitionerName,
    subject: 'Receta médica (Ley 25.649, prescripción por nombre genérico)',
    creator: brandTitle(),
    date: Number.isNaN(fecha.getTime()) ? new Date(0) : fecha,
  };
}

/**
 * Nombre del archivo, con la convención que ya se usa a mano al subirlo al
 * Firmador: `Receta-REC-XXXXXXXX-NombrePaciente.pdf`.
 */
export function recetaPdfFilename(data: RecetaPrintData): string {
  const paciente = data.patientName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '');
  return [`Receta-${data.recetaId}`, paciente].filter(Boolean).join('-') + '.pdf';
}

/** Bytes del PDF de la receta. */
export async function renderRecetaPdf(data: RecetaPrintData): Promise<Uint8Array> {
  return renderPdf((measure) => buildRecetaPdfBlocks(data, measure), recetaPdfMeta(data));
}

function filasPaciente(data: RecetaPrintData): { k: string; v: string }[] {
  return [
    { k: 'Paciente', v: data.patientName },
    data.patientBirthDate ? { k: 'Nacimiento', v: fmtDate(data.patientBirthDate) } : undefined,
    data.patientDni ? { k: 'DNI', v: data.patientDni } : undefined,
    data.patientSexo ? { k: 'Sexo', v: data.patientSexo } : undefined,
    data.coverage ? { k: 'Cobertura', v: data.coverage } : undefined,
  ].filter((f): f is { k: string; v: string } => Boolean(f));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString('es-AR', { timeZone: 'UTC' });
}

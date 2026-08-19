import { inflateSync } from 'zlib';
import { MARGIN } from '../pdf/document';
import type { Measure, PdfBlock, PdfText } from '../pdf/document';
import { buildRecetaPdfBlocks, recetaPdfFilename, recetaPdfMeta, renderRecetaPdf } from './receta-pdf';
import type { RecetaPrintData } from './receta-print';

/** Medidor de mentira, proporcional al largo: la maqueta no depende de la fuente real. */
const measure: Measure = (text, size, bold) => text.length * size * (bold ? 0.58 : 0.52);

const DATA: RecetaPrintData = {
  clinicName: 'Favaloro | Medplum Argentina',
  clinicSubtitle: 'Consultorio · Prescripción electrónica y laboratorio',
  patientName: 'Marice Bourdon',
  patientDni: '20.123.456',
  patientBirthDate: '1971-03-26',
  patientSexo: 'Femenino',
  practitionerName: "Dr Alejandro Sergio D'Alessandro",
  practitionerMatricula: 'MN-92179',
  diagnostico: 'Dislipidemia',
  recetaId: 'REC-B8B1B5DF',
  authoredOn: '2026-08-11T12:00:00Z',
  items: [{ medicamento: 'rosuvastatina — comprimidos 5 mg', cantidad: 1, posologia: '1 comprimido por día' }],
};

function textos(blocks: PdfBlock[]): string[] {
  return blocks.filter((b): b is PdfText => b.kind === 'text').map((b) => b.text);
}

describe('Maqueta de la receta', () => {
  const blocks = buildRecetaPdfBlocks(DATA, measure);

  test('lleva el conjunto mínimo de la receta', () => {
    const t = textos(blocks).join('\n');
    expect(t).toContain('RECETA MÉDICA');
    expect(t).toContain('REC-B8B1B5DF');
    expect(t).toContain('Marice Bourdon');
    expect(t).toContain('rosuvastatina — comprimidos 5 mg');
    expect(t).toContain('1 comprimido por día');
    expect(t).toContain('Dislipidemia');
    expect(t).toContain('Matrícula MN-92179');
    // Ley 25.649: la leyenda de sustitución no es opcional.
    expect(t).toContain('Ley 25.649');
  });

  test('la cantidad va en números y letras, como en el papel', () => {
    expect(textos(blocks).join('\n')).toContain('Cantidad: 1 (uno)');
  });

  // El documento no puede declarar una validez que no tiene. Sin firma es un
  // borrador, y el pie tiene que decirlo aunque el PDF después se firme afuera.
  test('sin firma el pie declara que no tiene validez legal', () => {
    expect(textos(blocks).join(' ')).toContain('No constituye una orden electrónica con validez legal');
  });

  test('firmada y sellada, el pie sube de tono y aparece la verificación', () => {
    const t = textos(
      buildRecetaPdfBlocks(
        { ...DATA, emissionStatus: 'signed-internal', seal: 'f'.repeat(64), verificationUrl: 'https://v/?receta=X' },
        measure
      )
    ).join('\n');
    expect(t).toContain('Sello de integridad:');
    expect(t).toContain('f'.repeat(16));
    expect(t).toContain('https://v/?receta=X');
    expect(t).toContain('Firmada por el profesional y sellada contra modificaciones');
  });

  test('sin sello no dibuja el bloque de verificación', () => {
    expect(textos(blocks).join('\n')).not.toContain('Sello de integridad');
  });

  // Un medicamento de nombre largo tiene que envolver, no salirse de la hoja.
  test('el nombre largo de un medicamento se envuelve en varias líneas', () => {
    const largo = 'metformina clorhidrato de liberación prolongada comprimidos recubiertos 1000 mg envase por 60';
    const t = textos(buildRecetaPdfBlocks({ ...DATA, items: [{ medicamento: largo }] }, measure));
    const lineas = t.filter((x) => largo.includes(x));
    expect(lineas.length).toBeGreaterThan(1);
    expect(lineas.join(' ')).toBe(largo);
  });

  test('nada se dibuja fuera del margen izquierdo', () => {
    for (const b of blocks) {
      if (b.kind === 'text' && b.align !== 'right' && b.align !== 'center') {
        expect(b.x).toBeGreaterThanOrEqual(MARGIN);
      }
    }
  });

  // Sin diagnóstico va la línea para completar a mano, no un texto inventado.
  test('sin diagnóstico deja la línea en blanco', () => {
    const sinDx = buildRecetaPdfBlocks({ ...DATA, diagnostico: undefined }, measure);
    expect(textos(sinDx).join('\n')).not.toContain('Dislipidemia');
    expect(sinDx.some((b) => b.kind === 'rule' && b.width === 240)).toBe(true);
  });
});

describe('Archivo', () => {
  // La convención que ya se usa a mano al subirlo al Firmador del Estado.
  test('el nombre sigue la convención Receta-<id>-<Paciente>.pdf', () => {
    expect(recetaPdfFilename(DATA)).toBe('Receta-REC-B8B1B5DF-MariceBourdon.pdf');
  });

  test('el nombre saca acentos y puntuación (nombres de archivo portables)', () => {
    expect(recetaPdfFilename({ ...DATA, patientName: 'José Ñuñez-Pérez' })).toBe('Receta-REC-B8B1B5DF-JoseNunezPerez.pdf');
  });

  // Si la fecha saliera del reloj, el mismo documento daría bytes distintos en
  // cada generación y no habría forma de probar que el PDF firmado es el que
  // emitimos.
  test('la fecha del PDF sale de la receta, no del reloj', () => {
    expect(recetaPdfMeta(DATA).date.toISOString()).toBe('2026-08-11T12:00:00.000Z');
  });

  test('una fecha inválida no rompe la generación', () => {
    expect(recetaPdfMeta({ ...DATA, authoredOn: 'no es fecha' }).date.getTime()).toBe(0);
  });
});

describe('PDF generado', () => {
  test('es un PDF y los mismos datos dan los MISMOS bytes', async () => {
    const a = await renderRecetaPdf(DATA);
    const b = await renderRecetaPdf(DATA);
    expect(Buffer.from(a.slice(0, 5)).toString()).toBe('%PDF-');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test('datos distintos dan bytes distintos', async () => {
    const a = await renderRecetaPdf(DATA);
    const b = await renderRecetaPdf({ ...DATA, recetaId: 'REC-OTRA' });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  // Verificación de punta a punta: el texto tiene que estar en el contenido de
  // la página, no solo en la lista de bloques.
  test('el texto llega a la página (no solo a la maqueta)', async () => {
    const bytes = await renderRecetaPdf(DATA);
    const contenido = streamsDeTexto(Buffer.from(bytes));
    expect(contenido).toContain('Marice Bourdon');
    expect(contenido).toContain('rosuvastatina');
    expect(contenido).toContain('REC-B8B1B5DF');
  });
});

/**
 * Descomprime los streams del PDF y decodifica los literales hexadecimales
 * (`<4D65...> Tj`), que es como pdf-lib escribe el texto. Sirve para verificar
 * que lo que se ve en el papel llegó de verdad al contenido de la página.
 */
function streamsDeTexto(pdf: Buffer): string {
  let out = '';
  let desde = 0;
  for (;;) {
    const inicio = pdf.indexOf('stream', desde);
    if (inicio === -1) {
      break;
    }
    const fin = pdf.indexOf('endstream', inicio);
    if (fin === -1) {
      break;
    }
    const cuerpo = pdf.subarray(pdf[inicio + 6] === 0x0d ? inicio + 8 : inicio + 7, fin);
    try {
      out += inflateSync(cuerpo).toString('latin1');
    } catch {
      out += cuerpo.toString('latin1');
    }
    desde = fin + 9;
  }
  return out.replace(/<([0-9A-Fa-f]+)>/g, (_m, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
}

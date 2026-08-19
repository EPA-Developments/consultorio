import { MARGIN } from '../pdf/document';
import type { Measure, PdfBlock, PdfText } from '../pdf/document';
import { buildLabOrderPdfBlocks, labOrderPdfFilename, labOrderPdfMeta, renderLabOrderPdf } from './lab-order-pdf';
import type { LabOrderPrintData } from './lab-order-print';

const measure: Measure = (text, size, bold) => text.length * size * (bold ? 0.58 : 0.52);

const DATA: LabOrderPrintData = {
  clinicName: 'Favaloro | Medplum Argentina',
  clinicSubtitle: 'Consultorio · Prescripción electrónica y laboratorio',
  patientName: 'Marice Bourdon',
  patientBirthDate: '1971-03-25',
  patientSex: 'Femenino',
  coverage: 'Swiss Medical',
  practitionerName: "Dr Alejandro Sergio D'Alessandro",
  practitionerMatricula: 'MN-92179',
  requisitionId: 'ORD-1AF44C76',
  authoredOn: '2026-08-18T12:00:00Z',
  intent: 'order',
  items: [
    { label: 'LDL Partículas (LDL-P)', code: '54434-1' },
    { label: 'Colesterol Total', code: '2093-3' },
    { label: 'Lipoproteína (a)', code: '43583-4' },
  ],
  fastingNote: 'Ayuno de 8 a 12 h para el perfil metabólico y lipídico.',
};

function textos(blocks: PdfBlock[]): string[] {
  return blocks.filter((b): b is PdfText => b.kind === 'text').map((b) => b.text);
}

describe('Maqueta de la orden de laboratorio', () => {
  const blocks = buildLabOrderPdfBlocks(DATA, measure);

  test('lleva el conjunto mínimo de la orden', () => {
    const t = textos(blocks).join('\n');
    expect(t).toContain('ORDEN DE LABORATORIO');
    expect(t).toContain('ORD-1AF44C76');
    expect(t).toContain('Marice Bourdon');
    expect(t).toContain('Matrícula MN-92179');
    expect(t).toContain('Swiss Medical');
  });

  test('la tabla lleva cada estudio con su código', () => {
    const t = textos(blocks);
    for (const item of DATA.items) {
      expect(t).toContain(item.label);
      expect(t).toContain(item.code);
    }
    expect(t.join('\n')).toContain('3 estudios solicitados');
  });

  test('un solo estudio no dice "estudios"', () => {
    const t = textos(buildLabOrderPdfBlocks({ ...DATA, items: [DATA.items[0]] }, measure)).join('\n');
    expect(t).toContain('1 estudio solicitado');
    expect(t).not.toContain('1 estudios');
  });

  // Un laboratorio que recibe una propuesta sin emitir no puede atenderla: el
  // papel tiene que decirlo, y decirlo arriba.
  test('una propuesta del paciente se declara como tal', () => {
    const t = textos(buildLabOrderPdfBlocks({ ...DATA, intent: 'proposal' }, measure)).join('\n');
    expect(t).toContain('Solicitud generada por el paciente');
  });

  test('una orden médica no lleva ese cartel', () => {
    expect(textos(blocks).join('\n')).not.toContain('Solicitud generada por el paciente');
  });

  test('sin firma el pie declara que no tiene validez legal', () => {
    expect(textos(blocks).join(' ')).toContain('No constituye una orden electrónica con validez legal');
  });

  test('firmada y sellada, aparece la verificación', () => {
    const t = textos(
      buildLabOrderPdfBlocks(
        { ...DATA, emissionStatus: 'signed-internal', seal: 'b'.repeat(64), verificationUrl: 'https://v/?orden=X' },
        measure
      )
    ).join('\n');
    expect(t).toContain('Sello de integridad:');
    expect(t).toContain('b'.repeat(16));
    expect(t).toContain('Firmada por el profesional y sellada contra modificaciones');
  });

  test('un estudio de nombre largo se envuelve, no se sale de la hoja', () => {
    const largo = 'Perfil lipídico avanzado con subfracciones de lipoproteínas y apolipoproteínas séricas';
    const t = textos(buildLabOrderPdfBlocks({ ...DATA, items: [{ label: largo }] }, measure));
    const lineas = t.filter((x) => largo.includes(x) && x.length > 3);
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
});

describe('Archivo de la orden', () => {
  test('el nombre sigue la convención Orden-<id>-<Paciente>.pdf', () => {
    expect(labOrderPdfFilename(DATA)).toBe('Orden-ORD-1AF44C76-MariceBourdon.pdf');
  });

  test('la fecha del PDF sale de la orden, no del reloj', () => {
    expect(labOrderPdfMeta(DATA).date.toISOString()).toBe('2026-08-18T12:00:00.000Z');
  });
});

describe('PDF generado', () => {
  // La propiedad que sostiene toda la verificación del firmado: mismos datos,
  // mismos bytes. Sin esto no se puede probar que el PDF que volvió firmado es
  // el que emitimos.
  test('los mismos datos dan los MISMOS bytes', async () => {
    const a = await renderLabOrderPdf(DATA);
    const b = await renderLabOrderPdf(DATA);
    expect(Buffer.from(a.slice(0, 5)).toString()).toBe('%PDF-');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test('otra orden da bytes distintos', async () => {
    const a = await renderLabOrderPdf(DATA);
    const b = await renderLabOrderPdf({ ...DATA, requisitionId: 'ORD-OTRA' });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

import { renderRecetaPdf } from '../recetas/receta-pdf';
import type { RecetaPrintData } from '../recetas/receta-print';
import { CUIL_MEDICO_TEST as CUIL_MEDICO, firmarComoElFirmador } from './signed-pdf.fixture';
import { cuilsDelCertificado, nombresDelCertificado, parseSignedPdf, verificarPdfFirmado } from './signed-pdf';

// Fixture SINTÉTICO a propósito. Un PDF firmado de verdad lleva el CUIL, el
// correo y el certificado de una persona real: eso no se versiona. Lo que se
// reproduce acá es la ESTRUCTURA que se verificó contra un documento real
// firmado por la Plataforma de Firma Digital Remota (agosto 2026):
// actualización incremental al final, PKCS#7 en /Contents y el archivo
// original intacto como prefijo.


const DATA: RecetaPrintData = {
  clinicName: 'Favaloro | Medplum Argentina',
  patientName: 'Marice Bourdon',
  practitionerName: 'Dra Test',
  practitionerMatricula: 'MN-92179',
  recetaId: 'REC-B8B1B5DF',
  authoredOn: '2026-08-11T12:00:00Z',
  items: [{ medicamento: 'rosuvastatina — comprimidos 5 mg', cantidad: 1 }],
};

describe('Lectura de un PDF firmado', () => {
  test('el original queda intacto como prefijo del firmado', async () => {
    const base = await renderRecetaPdf(DATA);
    const firmado = firmarComoElFirmador(base);
    expect(firmado.subarray(0, base.length).equals(Buffer.from(base))).toBe(true);
    expect(firmado.length).toBeGreaterThan(base.length);
  });

  test('lee el ByteRange, el subFilter y el momento de firma', async () => {
    const info = parseSignedPdf(firmarComoElFirmador(await renderRecetaPdf(DATA)));
    expect(info?.subFilter).toBe('adbe.pkcs7.detached');
    expect(info?.signingTime).toContain('D:20260818222024');
    expect(info?.cubreTodoElArchivo).toBe(true);
    expect(info?.byteRange[0]).toBe(0);
  });

  test('un PDF sin firma no se confunde con uno firmado', async () => {
    expect(parseSignedPdf(await renderRecetaPdf(DATA))).toBeUndefined();
  });

  test('saca el CUIL y el nombre del certificado', async () => {
    const info = parseSignedPdf(firmarComoElFirmador(await renderRecetaPdf(DATA)))!;
    expect(cuilsDelCertificado(info.pkcs7)).toStrictEqual([CUIL_MEDICO]);
    expect(nombresDelCertificado(info.pkcs7)).toContain('AC MODERNIZACION-PFDR');
    expect(nombresDelCertificado(info.pkcs7)).toContain('Dra Test');
  });
});

describe('Verificación contra la receta emitida', () => {
  test('el documento firmado es el que emitimos', async () => {
    const esperado = await renderRecetaPdf(DATA);
    const v = await verificarPdfFirmado({
      firmado: firmarComoElFirmador(esperado),
      esperado,
      cuilEsperado: '20-20541993-5',
    });
    expect(v.problemas).toStrictEqual([]);
    expect(v.contenidoEsElNuestro).toBe(true);
    expect(v.cubreTodoElArchivo).toBe(true);
    expect(v.resumenCoincide).toBe(true);
    expect(v.firmanteEsElPrescriptor).toBe(true);
    expect(v.cuilFirmante).toBe(CUIL_MEDICO);
  });

  // Lo que esta verificación existe para atrapar: alguien firma un documento
  // que NO es la receta que quedó guardada.
  test('un PDF firmado de OTRA receta no pasa', async () => {
    const v = await verificarPdfFirmado({
      firmado: firmarComoElFirmador(await renderRecetaPdf({ ...DATA, recetaId: 'REC-OTRA' })),
      esperado: await renderRecetaPdf(DATA),
    });
    expect(v.contenidoEsElNuestro).toBe(false);
    expect(v.problemas).toContain('El documento firmado no coincide con la receta emitida.');
  });

  test('firmado por otra persona: se detecta por CUIL', async () => {
    const esperado = await renderRecetaPdf(DATA);
    const v = await verificarPdfFirmado({
      firmado: firmarComoElFirmador(esperado, '27123456789', 'Otro Profesional'),
      esperado,
      cuilEsperado: CUIL_MEDICO,
    });
    expect(v.firmanteEsElPrescriptor).toBe(false);
    expect(v.problemas).toContain('El CUIL del firmante no es el del profesional que prescribió.');
  });

  // Alterar el contenido DESPUÉS de firmar rompe el resumen: es lo que hace
  // que la firma signifique algo.
  test('un archivo alterado después de firmarse no pasa', async () => {
    const esperado = await renderRecetaPdf(DATA);
    const firmado = firmarComoElFirmador(esperado);
    firmado[firmado.length - 12] ^= 0xff; // toca la cola, dentro del ByteRange
    const v = await verificarPdfFirmado({ firmado, esperado });
    expect(v.resumenCoincide).toBe(false);
    expect(v.problemas.join(' ')).toContain('alterado después de firmarse');
  });

  test('un archivo sin firma se rechaza sin fingir que la tiene', async () => {
    const esperado = await renderRecetaPdf(DATA);
    const v = await verificarPdfFirmado({ firmado: esperado, esperado });
    expect(v.tieneFirma).toBe(false);
    expect(v.problemas).toStrictEqual(['El archivo no tiene una firma digital legible.']);
  });
});

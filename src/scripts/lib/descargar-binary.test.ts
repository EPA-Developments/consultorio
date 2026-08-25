import { esUrlFirmada } from './descargar-binary';

// El servidor reescribe los Attachment a URLs de S3 ya firmadas. Mandarles
// además el header Authorization las invalida ("Only one auth mechanism
// allowed"), y S3 contesta un XML que el diagnóstico leía como si fuera el
// código del bot.
describe('URLs firmadas del bucket', () => {
  test('reconoce una presigned URL de S3', () => {
    const url =
      'https://s3.sa-east-1.amazonaws.com/storage.medplum.com.ar/binary/abc/def' +
      '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef&X-Amz-Expires=3600';
    expect(esUrlFirmada(url)).toBe(true);
  });

  test('una referencia Binary del servidor no está firmada', () => {
    expect(esUrlFirmada('https://api.medplum.com.ar/fhir/R4/Binary/abc')).toBe(false);
  });

  // Sin el ancla de query param, un id que contenga "signature" daría un falso
  // positivo y la descarga saldría sin token.
  test('no confunde la palabra en el path con un parámetro firmado', () => {
    expect(esUrlFirmada('https://api.medplum.com.ar/fhir/R4/Binary/signature-x')).toBe(false);
  });
});

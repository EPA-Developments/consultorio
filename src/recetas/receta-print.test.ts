import type { MedicationRequest, Patient } from '@medplum/fhirtypes';
import { buildRecetaPrintData, cantidadEnLetras, renderRecetaHtml } from './receta-print';

describe('Cantidad en letras', () => {
  test('los números habituales de una receta', () => {
    expect(cantidadEnLetras(1)).toBe('uno');
    expect(cantidadEnLetras(2)).toBe('dos');
    expect(cantidadEnLetras(16)).toBe('dieciséis');
    expect(cantidadEnLetras(28)).toBe('veintiocho');
    expect(cantidadEnLetras(30)).toBe('treinta');
    expect(cantidadEnLetras(45)).toBe('cuarenta y cinco');
    expect(cantidadEnLetras(90)).toBe('noventa');
  });

  // Fuera del rango habitual no se inventa: el documento muestra solo dígitos.
  test('fuera de rango devuelve undefined', () => {
    expect(cantidadEnLetras(1.5)).toBeUndefined();
    expect(cantidadEnLetras(100)).toBeUndefined();
    expect(cantidadEnLetras(-1)).toBeUndefined();
  });
});

describe('Impresión de la receta', () => {
  const PACIENTE: Patient = {
    resourceType: 'Patient',
    id: 'p1',
    name: [{ given: ['Ana'], family: 'Prueba' }],
    birthDate: '1980-05-01',
    identifier: [{ system: 'https://www.argentina.gob.ar/dni', value: '12345678' }],
  };
  const REQUEST: MedicationRequest = {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    subject: { reference: 'Patient/p1' },
    medicationCodeableConcept: { text: 'metformina — comprimidos 500 mg' },
    dispenseRequest: { quantity: { value: 2 } },
    dosageInstruction: [{ text: '1 comprimido cada 12 h, 30 días' }],
    reasonCode: [{ text: 'DM2' }],
    authoredOn: '2026-08-11T12:00:00Z',
  };

  const data = buildRecetaPrintData({
    recetaId: 'REC-TEST',
    requests: [REQUEST],
    patient: PACIENTE,
    coverage: 'Swiss Medical · SMG20 · N° 800006',
  });
  const html = renderRecetaHtml(data);

  // Números y letras juntos, como las recetas argentinas: dificulta adulterar
  // el papel.
  test('la cantidad sale en números y letras', () => {
    expect(html).toContain('Cantidad: 2 (dos)');
  });

  test('la cobertura conocida viaja al documento', () => {
    expect(data.coverage).toBe('Swiss Medical · SMG20 · N° 800006');
    expect(html).toContain('Swiss Medical');
  });

  test('DCI, posología y diagnóstico presentes', () => {
    expect(html).toContain('metformina — comprimidos 500 mg');
    expect(html).toContain('cada 12 h');
    expect(html).toContain('DM2');
  });
});

import type { MedicationRequest, Patient, Practitioner } from '@medplum/fhirtypes';
import { BRAND, brandTitle } from '../brand';
import { SELLO_RECETA_SYSTEM } from './receta-emision';
import { RECETA_SYSTEM } from './receta';
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
    gender: 'female',
    identifier: [{ system: 'https://www.argentina.gob.ar/dni', value: '12345678' }],
  };
  const MEDICO: Practitioner = {
    resourceType: 'Practitioner',
    id: 'dr1',
    name: [{ prefix: ['Dr'], given: ['Alejandro'], family: "D'Alessandro" }],
    identifier: [{ system: 'http://refeps.msal.gob.ar', value: 'MN-92179' }],
    address: [{ line: ['Husares 2248 6 E'], city: 'CABA' }],
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
    practitioner: MEDICO,
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

  // Conjunto mínimo de la Res. 1482/2024 (adjunto obligatorio del TAD):
  // sexo del paciente, domicilio del profesional y códigos de barras.
  test('el conjunto mínimo del registro está en el documento', () => {
    expect(html).toContain('Sexo');
    expect(html).toContain('Femenino');
    expect(html).toContain('Husares 2248 6 E');
    // Dos códigos de barras (receta y matrícula), cada uno con su texto legible.
    expect(html.match(/<svg/g)?.length).toBe(2);
    expect(html).toContain('REC-TEST');
    expect(html).toContain('MN-92179');
  });

  test('sin matrícula ni domicilio, el documento no inventa barras', () => {
    const sinDatos = renderRecetaHtml(
      buildRecetaPrintData({ recetaId: 'REC-X', requests: [REQUEST], patient: PACIENTE })
    );
    // Solo la barra del número de receta.
    expect(sinDatos.match(/<svg/g)?.length).toBe(1);
  });
  // El membrete es lo único que identifica al emisor en el papel. Sale de
  // src/brand.ts, nunca de un literal suelto: si alguien vuelve a clavar un
  // nombre en el módulo de impresión, este test lo encuentra.
  test('el membrete y el pie salen de la marca, no de un literal', () => {
    const html = renderRecetaHtml(
      buildRecetaPrintData({ recetaId: 'REC-TEST', requests: [REQUEST], patient: PACIENTE })
    );
    expect(html).toContain(BRAND.clinicName);
    expect(html).toContain(BRAND.clinicSubtitle);
    expect(html).toContain(`Generado desde ${brandTitle()}`);
    expect(html).not.toContain('BioWellness');
  });
  // El PDF de la receta es lo que se sube a firmar.gob.ar. Si no lleva el
  // sello impreso, el papel firmado y el registro FHIR no tienen ningún
  // vínculo verificable: se firmaría un documento que nadie puede cotejar.
  describe('Vínculo con el registro (sello impreso)', () => {
    // Como sale de buildReceta + createReceta: el número de receta va en
    // groupIdentifier y el sello en identifier.
    const sellada = {
      ...REQUEST,
      groupIdentifier: { system: RECETA_SYSTEM, value: 'REC-TEST' },
      identifier: [{ system: SELLO_RECETA_SYSTEM, value: 'a'.repeat(64) }],
    };

    test('una receta sellada imprime verificación y sello abreviado', () => {
      const html = renderRecetaHtml(
        buildRecetaPrintData({ recetaId: 'REC-TEST', requests: [sellada], patient: PACIENTE })
      );
      expect(html).toContain('Sello de integridad');
      expect(html).toContain('a'.repeat(16));
      // Abreviado: el hash entero no aporta a la lectura y ocupa dos renglones.
      expect(html).not.toContain('a'.repeat(64));
    });

    // Un borrador tiene número de receta pero no sello: no hay nada que
    // verificar todavía, y anunciar verificación sería mentir.
    test('sin sello no inventa un bloque de verificación', () => {
      const conNumero = { ...REQUEST, groupIdentifier: { system: RECETA_SYSTEM, value: 'REC-TEST' } };
      const html = renderRecetaHtml(
        buildRecetaPrintData({ recetaId: 'REC-TEST', requests: [conNumero], patient: PACIENTE })
      );
      expect(html).not.toContain('Sello de integridad');
    });
  });
});

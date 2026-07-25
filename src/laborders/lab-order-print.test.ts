import type { Patient, Practitioner, ServiceRequest } from '@medplum/fhirtypes';
import { DNI_SYSTEM, MATRICULA_SYSTEM } from '../ckm/argentina';
import { buildLabOrder, toLabOrderItems } from './lab-order';
import type { BiomarkerDefinition } from '../ckm/observation-definitions';
import { LOINC_SYSTEM } from '../ckm/observation-definitions';
import { buildPrintData, coverageFromNote, renderLabOrderHtml } from './lab-order-print';

function def(partial: Partial<BiomarkerDefinition>): BiomarkerDefinition {
  return { label: partial.label ?? 'X', conventional: [], optimal: [], ...partial };
}

const glucosa = def({
  biomarcadorId: 'glucosa-en-ayunas',
  label: 'Glucosa en Ayunas',
  code: '1558-6',
  system: LOINC_SYSTEM,
});
const insulina = def({ biomarcadorId: 'insulina-en-ayunas', label: 'Insulina', code: '27353-2', system: LOINC_SYSTEM });

const patient: Patient = {
  resourceType: 'Patient',
  id: 'p1',
  name: [{ given: ['Ana'], family: 'Pérez' }],
  birthDate: '1980-05-10',
  identifier: [{ system: DNI_SYSTEM, value: '30111222' }],
};
const practitioner: Practitioner = {
  resourceType: 'Practitioner',
  id: 'dr1',
  name: [{ given: ['Juan'], family: 'D’Alessandro', prefix: ['Dr.'] }],
  identifier: [{ system: MATRICULA_SYSTEM, value: 'MN 12345' }],
};

function order(intent: 'order' | 'proposal', note?: string): ServiceRequest[] {
  return buildLabOrder({
    subject: { reference: 'Patient/p1' },
    requester: { reference: 'Practitioner/dr1' },
    items: toLabOrderItems([glucosa, insulina]),
    requisitionId: 'ORD-ABC123',
    authoredOn: '2026-07-23T10:00:00Z',
    intent,
    note,
  });
}

describe('coverageFromNote', () => {
  test('extrae la cobertura de la nota', () => {
    expect(
      coverageFromNote({
        resourceType: 'ServiceRequest',
        status: 'active',
        intent: 'order',
        subject: {},
        note: [{ text: 'Cobertura: OSDE 210' }],
      })
    ).toBe('OSDE 210');
  });
  test('sin nota devuelve undefined', () => {
    expect(coverageFromNote(undefined)).toBeUndefined();
  });
});

describe('buildPrintData', () => {
  const data = buildPrintData({
    requisitionId: 'ORD-ABC123',
    requests: order('order', 'Cobertura: Swiss Medical'),
    patient,
    practitioner,
  });

  test('toma nombre, DNI y cobertura del paciente/orden', () => {
    expect(data.patientName).toContain('Pérez');
    expect(data.patientDni).toBe('30111222');
    expect(data.coverage).toBe('Swiss Medical');
  });

  test('toma matrícula del profesional', () => {
    expect(data.practitionerMatricula).toBe('MN 12345');
    expect(data.practitionerName).toContain('D’Alessandro');
  });

  test('lista los estudios con su código', () => {
    expect(data.items).toHaveLength(2);
    expect(data.items.map((i) => i.label).sort()).toEqual(['Glucosa en Ayunas', 'Insulina']);
    expect(data.items.find((i) => i.label === 'Glucosa en Ayunas')?.code).toBe('1558-6');
  });

  test('intent proposal se refleja', () => {
    const p = buildPrintData({ requisitionId: 'ORD-X', requests: order('proposal'), patient });
    expect(p.intent).toBe('proposal');
    expect(p.practitionerMatricula).toBeUndefined();
  });
});

describe('renderLabOrderHtml', () => {
  const data = buildPrintData({
    requisitionId: 'ORD-ABC123',
    requests: order('order', 'Cobertura: OMINT'),
    patient,
    practitioner,
  });
  const html = renderLabOrderHtml(data);

  test('es un documento HTML completo', () => {
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
  });

  test('incluye número de orden, paciente, matrícula y estudios', () => {
    expect(html).toContain('ORD-ABC123');
    expect(html).toContain('Pérez');
    expect(html).toContain('Matrícula MN 12345');
    expect(html).toContain('Glucosa en Ayunas');
    expect(html).toContain('1558-6');
    expect(html).toContain('OMINT');
  });

  test('lleva el título de orden y el disclaimer legal de Fase 1', () => {
    expect(html).toContain('Orden de laboratorio');
    expect(html).toContain('Res. 2214/2025');
    expect(html).toContain('Documento de trabajo');
  });

  test('una solicitud del paciente muestra el banner y el título de solicitud', () => {
    const p = renderLabOrderHtml(buildPrintData({ requisitionId: 'ORD-Y', requests: order('proposal'), patient }));
    expect(p).toContain('Solicitud de estudios');
    expect(p).toContain('Requiere revisión y emisión del médico');
  });

  test('la leyenda legal refleja el estado de emisión (no miente sobre la validez)', () => {
    const firmada = renderLabOrderHtml({ ...data, emissionStatus: 'signed-internal' });
    expect(firmada).toContain('Pendiente de emisión');
    expect(firmada).not.toContain('No constituye');

    const emitida = renderLabOrderHtml({ ...data, emissionStatus: 'legally-emitted' });
    expect(emitida).toContain('ReNaPDiS');
    expect(emitida).not.toContain('Pendiente de emisión');
  });

  test('sin sello NO se imprime el bloque de verificación', () => {
    expect(renderLabOrderHtml(data)).not.toContain('Sello de integridad');
  });

  test('con sello y URL se imprime la verificación', () => {
    const html = renderLabOrderHtml({
      ...data,
      emissionStatus: 'signed-internal',
      verificationUrl: 'https://bio.medplum.com.ar/verificar?orden=ORD-1',
      seal: 'abcdef0123456789abcdef',
    });
    expect(html).toContain('Sello de integridad');
    expect(html).toContain('verificar?orden=ORD-1');
    expect(html).toContain('abcdef0123456789'); // abreviado a 16 chars
  });

  test('escapa HTML de campos de texto (no rompe el markup)', () => {
    const evil = renderLabOrderHtml({
      ...data,
      patientName: '<script>alert(1)</script>',
    });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&lt;script&gt;');
  });
});

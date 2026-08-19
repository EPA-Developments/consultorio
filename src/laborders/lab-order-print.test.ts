import type { Patient, Practitioner, ServiceRequest } from '@medplum/fhirtypes';
import { BRAND, brandTitle } from '../brand';
import { DNI_SYSTEM, MATRICULA_SYSTEM } from '../ckm/argentina';
import { buildLabOrder, toLabOrderItems } from './lab-order';
import type { BiomarkerDefinition } from '../ckm/observation-definitions';
import { LOINC_SYSTEM } from '../ckm/observation-definitions';
import {
  buildPrintData,
  coverageFromNote,
  diagnosisFromRequests,
  renderLabOrderHtml,
  specialtyOf,
} from './lab-order-print';

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
    notas: note ? [note] : undefined,
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

describe('Conjunto mínimo de datos (instructivo ReNaPDiS 08.24)', () => {
  const patientFull: Patient = { ...patient, gender: 'female' };
  const practitionerFull: Practitioner = {
    ...practitioner,
    qualification: [{ code: { coding: [{ display: 'Medicina Interna' }] } }],
    address: [{ line: ['Av. Centenario 1234'], city: 'San Isidro', state: 'Buenos Aires' }],
  };

  test('sexo del paciente se traduce al español', () => {
    const d = buildPrintData({ requisitionId: 'O', requests: order('order'), patient: patientFull });
    expect(d.patientSex).toBe('Femenino');
  });

  test('especialidad se resuelve desde coding.display cuando no hay text', () => {
    expect(specialtyOf(practitionerFull)).toBe('Medicina Interna');
    expect(specialtyOf(practitioner)).toBeUndefined();
  });

  test('domicilio profesional se formatea', () => {
    const d = buildPrintData({
      requisitionId: 'O',
      requests: order('order'),
      patient,
      practitioner: practitionerFull,
    });
    expect(d.practitionerAddress).toContain('Av. Centenario 1234');
  });

  test('diagnóstico se toma de ServiceRequest.reasonCode', () => {
    const reqs = order('order').map((r) => ({ ...r, reasonCode: [{ text: 'Dislipemia' }] }));
    expect(diagnosisFromRequests(reqs)).toBe('Dislipemia');
    expect(diagnosisFromRequests(order('order'))).toBeUndefined();
  });

  test('el HTML incluye sexo, especialidad, domicilio y diagnóstico', () => {
    const reqs = order('order').map((r) => ({ ...r, reasonCode: [{ text: 'Dislipemia' }] }));
    const html = renderLabOrderHtml(
      buildPrintData({
        requisitionId: 'ORD-1',
        requests: reqs,
        patient: patientFull,
        practitioner: practitionerFull,
      })
    );
    expect(html).toContain('Femenino');
    expect(html).toContain('Medicina Interna');
    expect(html).toContain('Av. Centenario 1234');
    expect(html).toContain('Dislipemia');
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

  test('imprime el rótulo de diagnóstico aunque no haya dato (línea para completar)', () => {
    expect(html).toContain('Diagnóstico:');
    expect(html).toContain('class="blank"');
  });

  test('NO inventa leyenda de inscripción en el registro si no hay inscripción', () => {
    expect(html).not.toMatch(/inscripto|inscripta|Registro Nacional de Plataformas/i);
  });

  test('imprime la leyenda de registro solo cuando se la pasan', () => {
    const conRegistro = renderLabOrderHtml({ ...data, registryLegend: 'Recetario inscripto en ReNaPDiS N° 1234.' });
    expect(conRegistro).toContain('ReNaPDiS N° 1234');
  });

  test('escapa HTML de campos de texto (no rompe el markup)', () => {
    const evil = renderLabOrderHtml({
      ...data,
      patientName: '<script>alert(1)</script>',
    });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&lt;script&gt;');
  });
  // Mismo criterio que la receta: el emisor del papel sale de src/brand.ts.
  test('el membrete y el pie salen de la marca, no de un literal', () => {
    expect(html).toContain(BRAND.clinicName);
    expect(html).toContain(BRAND.clinicSubtitle);
    expect(html).toContain(`Generado desde ${brandTitle()}`);
    expect(html).not.toContain('BioWellness');
  });
  // Regresión de un defecto visto en una orden REAL impresa: la cobertura salía
  // como "Swiss Medical · Matrícula sin verificar contra REFEPS al emitir
  // (registro sin respuesta)". La constancia, disfrazada de plan de cobertura,
  // en un documento clínico.
  test('la cobertura no arrastra la constancia REFEPS de una orden vieja', () => {
    const vieja: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      subject: { reference: 'Patient/p1' },
      note: [
        {
          text: 'Cobertura: Swiss Medical · Matrícula sin verificar contra REFEPS al emitir (registro sin respuesta)',
        },
      ],
    };
    expect(coverageFromNote(vieja)).toBe('Swiss Medical');
  });

  test('una cobertura con separadores propios se conserva entera', () => {
    const conPlan: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      subject: { reference: 'Patient/p1' },
      note: [{ text: 'Cobertura: Swiss Medical · SMG20 · N° 800006' }],
    };
    expect(coverageFromNote(conPlan)).toBe('Swiss Medical · SMG20 · N° 800006');
  });
});

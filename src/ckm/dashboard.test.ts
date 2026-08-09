import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { CKM_STAGE_URL, HGRAPH_DATA_URL } from './constants';
import { compareRows, loadDashboardRows } from './dashboard';
import type { DashboardRow, DashboardSortField } from './dashboard';

describe('Carga del panel CKM', () => {
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const filename of SEARCH_PARAMETER_BUNDLE_FILES) {
      indexSearchParameterBundle(readJson(filename) as Bundle<SearchParameter>);
    }
  });

  test('arma las filas con estadío, PREVENT y alerta (datos como los del seed)', async () => {
    const medplum = new MockClient();
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Jorge'], family: 'Demo' }],
      extension: [
        { url: CKM_STAGE_URL, valueInteger: 3 },
        {
          url: HGRAPH_DATA_URL,
          valueString: JSON.stringify({
            metrics: [
              { id: 'cac', label: 'Score de calcio', value: 220, unit: 'Agatston', score: 0.45, status: 'moderate' },
            ],
            prevent: { ascvd10y: 18.2, hf10y: 12.4, cvdTotal30y: 41.9 },
          }),
        },
      ],
    });
    const otherPatient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Sin'], family: 'Datos' }],
    });
    await medplum.createResource({
      resourceType: 'Communication',
      status: 'in-progress',
      category: [
        { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/communication-category', code: 'alert' }] },
      ],
      subject: { reference: `Patient/${patient.id}` },
      payload: [{ contentString: 'Riesgo PREVENT-CVD elevado' }],
    });

    const rows = await loadDashboardRows(medplum);

    const jorge = rows.find((r) => r.patient.id === patient.id);
    expect(jorge).toMatchObject({
      name: 'Jorge Demo',
      stage: 3,
      ascvd10y: 18.2,
      hf10y: 12.4,
      cvdTotal30y: 41.9,
      cac: 220,
      hasAlert: true,
    });

    const sinDatos = rows.find((r) => r.patient.id === otherPatient.id);
    expect(sinDatos).toMatchObject({
      stage: undefined,
      ascvd10y: undefined,
      hf10y: undefined,
      cvdTotal30y: undefined,
      cac: undefined,
      hasAlert: false,
    });
  });

  test('una alerta completada (leída) no marca la fila', async () => {
    const medplum = new MockClient();
    const patient = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Test' }] });
    await medplum.createResource({
      resourceType: 'Communication',
      status: 'completed',
      category: [
        { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/communication-category', code: 'alert' }] },
      ],
      subject: { reference: `Patient/${patient.id}` },
    });

    const rows = await loadDashboardRows(medplum);
    expect(rows.find((r) => r.patient.id === patient.id)?.hasAlert).toBe(false);
  });
});

describe('compareRows — orden del panel', () => {
  function row(overrides: Partial<DashboardRow> & { name: string }): DashboardRow {
    return { patient: { resourceType: 'Patient' }, hasAlert: false, ...overrides };
  }

  // A y B tienen todos los datos; C no tiene ninguno. Para cada outcome se
  // eligen valores que cambian quién va primero, así un test detecta si el
  // comparador usa la clave equivocada.
  const A = row({ name: 'A', stage: 1, ascvd10y: 5, hf10y: 30, cvdTotal30y: 10 });
  const B = row({ name: 'B', stage: 3, ascvd10y: 20, hf10y: 10, cvdTotal30y: 40 });
  const C = row({ name: 'C' });

  function order(field: DashboardSortField, descending: boolean): string[] {
    return [A, C, B]
      .slice()
      .sort((x, y) => compareRows({ field, descending }, x, y))
      .map((r) => r.name);
  }

  test('desc por ASCVD: mayor primero, sin dato al final', () => {
    expect(order('ascvd10y', true)).toStrictEqual(['B', 'A', 'C']);
  });

  test('asc por ASCVD: menor primero, sin dato igual al final', () => {
    expect(order('ascvd10y', false)).toStrictEqual(['A', 'B', 'C']);
  });

  test('desc por estadío', () => {
    expect(order('stage', true)).toStrictEqual(['B', 'A', 'C']);
  });

  test('desc por IC usa la clave hf10y (A>B), no ascvd10y', () => {
    expect(order('hf10y', true)).toStrictEqual(['A', 'B', 'C']);
  });

  test('desc por ECV usa la clave cvdTotal30y (B>A)', () => {
    expect(order('cvdTotal30y', true)).toStrictEqual(['B', 'A', 'C']);
  });

  test('sin dato va SIEMPRE al final, en ambas direcciones', () => {
    expect(order('ascvd10y', true).at(-1)).toBe('C');
    expect(order('ascvd10y', false).at(-1)).toBe('C');
  });

  test('dos filas sin dato son equivalentes (devuelve 0)', () => {
    expect(compareRows({ field: 'ascvd10y', descending: true }, C, row({ name: 'C2' }))).toBe(0);
  });
});

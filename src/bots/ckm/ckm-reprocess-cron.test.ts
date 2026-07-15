import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import type { BotEvent } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import type { Bundle, Observation, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { HGRAPH_DATA_URL, LOINC, LOINC_SYSTEM } from '../../ckm/constants';
import { handler } from './ckm-reprocess-cron';

const cronEvent = { bot: { reference: 'Bot/123' }, contentType: 'application/fhir+json', input: undefined, secrets: {} };

function labObservation(patientId: string, code: string, value: number, unit: string, date: string): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: date,
    code: { coding: [{ system: LOINC_SYSTEM, code }] },
    valueQuantity: { value, unit },
  };
}

function metricsOf(patient: Patient): unknown[] | undefined {
  const raw = patient.extension?.find((e) => e.url === HGRAPH_DATA_URL)?.valueString;
  return raw ? (JSON.parse(raw) as { metrics?: unknown[] }).metrics : undefined;
}

describe('Bot ckm-reprocess-cron', () => {
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const filename of SEARCH_PARAMETER_BUNDLE_FILES) {
      indexSearchParameterBundle(readJson(filename) as Bundle<SearchParameter>);
    }
  });

  test('recalcula los pacientes con datos CKM y saltea los que no tienen', async () => {
    const medplum = new MockClient();
    const withData = await medplum.createResource<Patient>({ resourceType: 'Patient', gender: 'female' });
    await medplum.createResource(labObservation(withData.id as string, LOINC.hba1c, 5.4, '%', '2026-06-01'));
    const noData = await medplum.createResource<Patient>({ resourceType: 'Patient', gender: 'male' });

    const result = await handler(medplum, cronEvent as unknown as BotEvent);

    expect(result.errors).toBe(0);
    expect(result.processed).toBeGreaterThanOrEqual(2);
    // El que tiene datos quedó con métricas persistidas.
    const refreshedWith = await medplum.readResource('Patient', withData.id as string);
    expect(metricsOf(refreshedWith)?.length).toBeGreaterThan(0);
    // El sin datos no quedó con extensión CKM (recomputeCKM lo saltea).
    const refreshedNo = await medplum.readResource('Patient', noData.id as string);
    expect(metricsOf(refreshedNo)).toBeUndefined();
  });
});

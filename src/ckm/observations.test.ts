import type { Observation } from '@medplum/fhirtypes';
import { LOINC, LOINC_BP_PANEL, LOINC_SYSTEM } from './constants';
import { extractCKMValues, latestCKMValues } from './observations';

function bpPanel(systolic: number, diastolic: number, date: string): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    code: { coding: [{ system: LOINC_SYSTEM, code: LOINC_BP_PANEL }] },
    effectiveDateTime: date,
    component: [
      {
        code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.sbp }] },
        valueQuantity: { value: systolic, unit: 'mmHg' },
      },
      {
        code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.dbp }] },
        valueQuantity: { value: diastolic, unit: 'mmHg' },
      },
    ],
  };
}

function singleObservation(code: string, value: number, unit: string, date: string): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    code: { coding: [{ system: LOINC_SYSTEM, code }] },
    effectiveDateTime: date,
    valueQuantity: { value, unit },
  };
}

describe('Observations CKM unificadas', () => {
  test('panel de presión arterial (rol paciente): un recurso, dos valores', () => {
    const values = extractCKMValues(bpPanel(137, 85, '2026-06-01'));
    expect(values.sbp).toMatchObject({ value: 137, unit: 'mmHg' });
    expect(values.dbp).toMatchObject({ value: 85, unit: 'mmHg' });
  });

  test('observations sueltas de PA (forma legacy): también se leen', () => {
    const values = latestCKMValues([
      singleObservation(LOINC.sbp, 142, 'mmHg', '2026-06-02'),
      singleObservation(LOINC.dbp, 90, 'mmHg', '2026-06-02'),
    ]);
    expect(values.sbp?.value).toBe(142);
    expect(values.dbp?.value).toBe(90);
  });

  test('gana el valor más reciente por fecha clínica, mezclando formas', () => {
    const values = latestCKMValues([
      bpPanel(150, 95, '2026-06-10'),
      singleObservation(LOINC.sbp, 120, 'mmHg', '2026-01-15'),
      singleObservation(LOINC.hba1c, 6.7, '%', '2026-05-20'),
    ]);
    expect(values.sbp?.value).toBe(150);
    expect(values.dbp?.value).toBe(95);
    expect(values.hba1c?.value).toBe(6.7);
  });

  test('parámetros de laboratorio individuales (rol médico)', () => {
    const values = latestCKMValues([
      singleObservation(LOINC.egfr, 71, 'mL/min/1.73m²', '2026-06-01'),
      singleObservation(LOINC.uacr, 28, 'mg/g', '2026-06-01'),
      singleObservation(LOINC.cholesterolTotal, 210, 'mg/dL', '2026-06-01'),
    ]);
    expect(values.egfr?.value).toBe(71);
    expect(values.uacr?.value).toBe(28);
    expect(values.cholesterolTotal?.value).toBe(210);
  });

  test('PA implausible (sistólica <= diastólica): se descarta y no pisa la lectura válida anterior', () => {
    const values = latestCKMValues([
      bpPanel(128, 82, '2026-06-01'),
      // Carga cruzada: 87/160
      bpPanel(87, 160, '2026-06-12'),
      singleObservation(LOINC.hba1c, 6.1, '%', '2026-06-12'),
    ]);
    expect(values.sbp?.value).toBe(128);
    expect(values.dbp?.value).toBe(82);
    expect(values.hba1c?.value).toBe(6.1);
  });

  test('ignora códigos que no son CKM', () => {
    const values = extractCKMValues(singleObservation('8302-2', 170, 'cm', '2026-06-01'));
    expect(Object.keys(values)).toHaveLength(0);
  });

  test('sinónimos LOINC de lab se leen como el parámetro CKM correcto', () => {
    // eGFR CKD-EPI 2021 (98979-8) → egfr; LDL medido (2089-1) → ldlc.
    const values = latestCKMValues([
      singleObservation('98979-8', 62, 'mL/min/1.73m²', '2026-06-01'),
      singleObservation('2089-1', 80, 'mg/dL', '2026-06-01'),
      singleObservation('2160-0', 1.32, 'mg/dL', '2026-06-01'),
    ]);
    expect(values.egfr?.value).toBe(62);
    expect(values.ldlc?.value).toBe(80);
    expect(values.creatinine?.value).toBe(1.32);
  });

  test('el sinónimo más reciente pisa al primario más viejo (mismo parámetro)', () => {
    const values = latestCKMValues([
      singleObservation(LOINC.egfr, 90, 'mL/min/1.73m²', '2026-05-01'), // 62238-1, más viejo
      singleObservation('98979-8', 62, 'mL/min/1.73m²', '2026-06-01'), // CKD-EPI 2021, más nuevo
    ]);
    expect(values.egfr?.value).toBe(62);
  });
});

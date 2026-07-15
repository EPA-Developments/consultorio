import type { Observation } from '@medplum/fhirtypes';
import { classifyEnhancer, readEnhancers, resolveEnhancer, RISK_ENHANCERS } from './biomarkers';
import type { BiomarkerDefinition } from './observation-definitions';

const apob = RISK_ENHANCERS.find((e) => e.id === 'apob')!;
const lpa = RISK_ENHANCERS.find((e) => e.id === 'lpa')!;

describe('classifyEnhancer — ApoB (óptimo <90, convencional <130 mg/dL)', () => {
  test.each([
    [70, 'optimal'],
    [89.9, 'optimal'],
    [90, 'borderline'],
    [129.9, 'borderline'],
    [130, 'high'],
    [180, 'high'],
  ])('ApoB %d -> %s', (value, level) => {
    expect(classifyEnhancer(apob, value).level).toBe(level);
  });
});

describe('classifyEnhancer — Lp(a) (óptimo <50, convencional <75 nmol/L)', () => {
  test.each([
    [20, 'optimal'],
    [49.9, 'optimal'],
    [50, 'borderline'],
    [74.9, 'borderline'],
    [75, 'high'],
    [180, 'high'],
  ])('Lp(a) %d -> %s', (value, level) => {
    expect(classifyEnhancer(lpa, value).level).toBe(level);
  });
});

describe('classifyEnhancer — presentación', () => {
  test('cada nivel expone label y color de Mantine', () => {
    expect(classifyEnhancer(apob, 50)).toMatchObject({ label: 'Óptimo', color: 'green' });
    expect(classifyEnhancer(apob, 100)).toMatchObject({ label: 'Límite', color: 'yellow' });
    expect(classifyEnhancer(apob, 150)).toMatchObject({ label: 'Elevado', color: 'red' });
  });
});

function obs(
  code: string,
  value: number | undefined,
  date: string,
  status: Observation['status'] = 'final',
  unit = 'mg/dL'
): Observation {
  return {
    resourceType: 'Observation',
    status,
    code: { coding: [{ system: 'http://loinc.org', code }] },
    effectiveDateTime: date,
    ...(value !== undefined ? { valueQuantity: { value, unit } } : {}),
  };
}

describe('readEnhancers', () => {
  test('toma la última lectura por código y la clasifica', () => {
    const readings = readEnhancers([
      obs('1884-6', 75, '2026-01-01'),
      obs('1884-6', 142, '2026-06-01'), // más nueva: gana
      obs('102725-2', 30, '2026-05-01', 'final', 'nmol/L'),
    ]);
    const apobReading = readings.find((r) => r.def.id === 'apob');
    const lpaReading = readings.find((r) => r.def.id === 'lpa');
    expect(apobReading).toMatchObject({ value: 142, info: { level: 'high' } });
    expect(lpaReading).toMatchObject({ value: 30, info: { level: 'optimal' } });
  });

  test('Lp(a) se lee por su LOINC molar sinónimo 43583-4 (no solo 102725-2)', () => {
    const readings = readEnhancers([obs('43583-4', 20, '2026-06-01', 'final', 'nmol/L')]);
    expect(readings.find((r) => r.def.id === 'lpa')).toMatchObject({ value: 20, info: { level: 'optimal' } });
  });

  test('Lp(a) codificado con el LOINC de masa 10835-7 pero reportado en nmol/L se grada molar', () => {
    // Caso real del lab: usa 10835-7 (masa) pero el valor viene en nmol/L.
    const readings = readEnhancers([obs('10835-7', 20, '2026-06-01', 'final', 'nmol/L')]);
    expect(readings.find((r) => r.def.id === 'lpa')).toMatchObject({ value: 20, info: { level: 'optimal' } });
  });

  test('Lp(a) en masa (mg/dL) usa los cutoffs de masa (30/50), no los molares', () => {
    expect(readEnhancers([obs('10835-7', 20, '2026-06-01', 'final', 'mg/dL')])[0].info.level).toBe('optimal');
    expect(readEnhancers([obs('10835-7', 45, '2026-06-01', 'final', 'mg/dL')])[0].info.level).toBe('borderline');
    expect(readEnhancers([obs('10835-7', 55, '2026-06-01', 'final', 'mg/dL')])[0].info.level).toBe('high');
  });

  test('ignora entered-in-error y observaciones sin valor', () => {
    const readings = readEnhancers([
      obs('1884-6', 200, '2026-06-10', 'entered-in-error'),
      obs('1884-6', undefined, '2026-06-09'),
      obs('1884-6', 95, '2026-06-08'),
    ]);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ value: 95, info: { level: 'borderline' } });
  });

  test('un potenciador sin Observation no aparece en el resultado', () => {
    const readings = readEnhancers([obs('1884-6', 100, '2026-06-01')]);
    expect(readings.map((r) => r.def.id)).toStrictEqual(['apob']);
  });

  test('sin observaciones devuelve lista vacía', () => {
    expect(readEnhancers([])).toStrictEqual([]);
  });

  test('usa los umbrales de la ObservationDefinition cuando se pasa el índice', () => {
    // Con el hardcode (convencional <130), ApoB 95 sería "Límite". Si la OD baja
    // el convencional a <90, 95 pasa a "Elevado": la clasificación sigue al FHIR.
    const byLoinc = new Map<string, BiomarkerDefinition>([
      ['1884-6', { label: 'ApoB', conventional: [{ high: 90 }], optimal: [{ high: 70 }] }],
    ]);
    expect(readEnhancers([obs('1884-6', 95, '2026-06-01')], byLoinc)[0].info.level).toBe('high');
    // Sin el índice, el mismo valor es "Límite" (hardcode).
    expect(readEnhancers([obs('1884-6', 95, '2026-06-01')])[0].info.level).toBe('borderline');
  });
});

describe('resolveEnhancer — rangos dinámicos desde ObservationDefinition', () => {
  const od = (over: Partial<BiomarkerDefinition>): BiomarkerDefinition => ({
    label: 'X',
    conventional: [],
    optimal: [],
    ...over,
  });

  test('sin OD devuelve el hardcode tal cual', () => {
    expect(resolveEnhancer(apob, undefined)).toBe(apob);
  });

  test('toma óptimo/convencional, unidad, interpretación y fuente de la OD', () => {
    const def = resolveEnhancer(
      apob,
      od({
        optimal: [{ high: 80 }],
        conventional: [{ high: 120 }],
        unit: 'mg/dL (FHIR)',
        interpretation: 'interpretación dinámica',
        source: 'fuente dinámica',
      })
    );
    expect(def).toMatchObject({
      optimalBelow: 80,
      conventionalBelow: 120,
      unit: 'mg/dL (FHIR)',
      interpretation: 'interpretación dinámica',
      source: 'fuente dinámica',
    });
  });

  test('si la OD no trae high, conserva el umbral del hardcode', () => {
    const def = resolveEnhancer(apob, od({ optimal: [{ low: 1 }], conventional: [] }));
    expect(def.optimalBelow).toBe(apob.optimalBelow);
    expect(def.conventionalBelow).toBe(apob.conventionalBelow);
  });
});

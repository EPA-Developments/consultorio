import type { Bundle, ObservationDefinition } from '@medplum/fhirtypes';
import bundleJson from '../../data/ckm/biomarker-definitions.json';
import { bandForKey, resolveSeedValue, roundSeedValue, seedSeries, seedValueFor } from './biomarker-seed';
import {
  classifyBiomarkerValue,
  indexByBiomarcador,
  parseObservationDefinition,
  rangeFor,
} from './observation-definitions';

const defs = ((bundleJson as unknown as Bundle).entry ?? [])
  .map((e) => e.resource as ObservationDefinition)
  .filter((r) => r?.resourceType === 'ObservationDefinition')
  .map(parseObservationDefinition);
const byId = indexByBiomarcador(defs);

/**
 * Edad de referencia para sembrar. Hace falta porque algunos rangos son por
 * franja etaria (testosterona libre en mujeres, pre y posmenopausia) y sin
 * edad no hay rango aplicable.
 */
const EDAD_ADULTA = 40;

describe('seedValueFor — cae en la banda pedida (sobre las 109 reales)', () => {
  test('banda "optimal" clasifica como Óptimo en toda def con rango óptimo', () => {
    const withOptimal = defs.filter((d) => d.optimal.length > 0);
    expect(withOptimal.length).toBeGreaterThan(0);
    for (const def of withOptimal) {
      const v = seedValueFor(def, 'male', 'optimal');
      expect(v, `${def.label} optimal`).toBeDefined();
      expect(classifyBiomarkerValue(def, v, 'male').status, `${def.label} optimal`).toBe('optimal');
    }
  });

  test('banda "out" clasifica como Alto/Bajo en toda def con rango convencional', () => {
    const withConventional = defs.filter((d) => d.conventional.length > 0);
    for (const def of withConventional) {
      const v = seedValueFor(def, 'male', 'out');
      expect(v, `${def.label} out`).toBeDefined();
      expect(['high', 'low'], `${def.label} out`).toContain(classifyBiomarkerValue(def, v, 'male').status);
    }
  });

  test('banda "normal" clasifica como Normal en toda def con brecha construible (male y female)', () => {
    let covered = 0;
    for (const gender of ['male', 'female']) {
      for (const def of defs) {
        const v = seedValueFor(def, gender, 'normal');
        if (v === undefined) {
          continue;
        }
        covered++;
        expect(classifyBiomarkerValue(def, v, gender).status, `${def.label} (${gender})`).toBe('normal');
      }
    }
    expect(covered).toBeGreaterThan(20);
  });
});

describe('coherencia de los rangos del catálogo', () => {
  // Un rango óptimo enteramente fuera del convencional casi siempre significa
  // que los dos están escritos en unidades distintas, y con eso no hay valor
  // que se pueda clasificar bien. Pasó con Zinc sérico (µg/mL vs µg/dL) y con
  // Testosterona Libre (pg/mL vs ng/dL): el panel los mostraba mal.
  // Se recorren varias edades además de los dos géneros para que también entren
  // los rangos por franja etaria.
  const PERFILES: [string, number][] = [
    ['male', 30],
    ['male', 65],
    ['female', 30],
    ['female', 65],
  ];

  test('ninguna definición tiene el óptimo fuera del convencional', () => {
    const incoherentes = defs
      .filter((d) =>
        PERFILES.some(([g, edad]) => {
          const c = rangeFor(d.conventional, g, edad);
          const o = rangeFor(d.optimal, g, edad);
          if (!c || !o) {
            return false;
          }
          return (o.low ?? -Infinity) > (c.high ?? Infinity) || (o.high ?? Infinity) < (c.low ?? -Infinity);
        })
      )
      .map((d) => d.label);
    expect(incoherentes).toStrictEqual([]);
  });

  /**
   * Misma unidad escrita de dos maneras: la definición declara la forma que se
   * muestra en pantalla y el rango usa el código UCUM. No es un error, así que
   * no cuenta como desalineación.
   */
  const SINONIMOS: Record<string, string> = {
    'mL/min/{1.73_m2}': 'mL/min/1.73m2',
    '{index}': 'indice',
    'u[IU]/mL': 'uUI/mL',
  };
  const canonica = (u: string): string => SINONIMOS[u] ?? u;

  // Las unidades de los rangos tienen que coincidir con la que declara la
  // definición; si no, el número que se muestra no es el que se comparó. Así
  // estaban Zinc sérico (µg/mL vs µg/dL) y Testosterona Libre (pg/mL vs ng/dL).
  test('cada rango está en la unidad declarada por su definición', () => {
    const bundleEntries = ((bundleJson as unknown as Bundle).entry ?? []).map((e) => e.resource as ObservationDefinition);
    const desalineadas: string[] = [];
    for (const od of bundleEntries) {
      const unidad = od.quantitativeDetails?.unit?.coding?.[0]?.code;
      for (const q of od.qualifiedInterval ?? []) {
        for (const bound of [q.range?.low, q.range?.high]) {
          const u = bound?.code ?? bound?.unit;
          if (u && unidad && canonica(u) !== canonica(unidad)) {
            desalineadas.push(`${od.code?.text}: ${u} != ${unidad}`);
          }
        }
      }
    }
    expect(desalineadas).toStrictEqual([]);
  });
});

describe('resolveSeedValue', () => {
  test('siempre resuelve un valor para defs con algún rango', () => {
    for (const def of defs) {
      if (def.optimal.length > 0 || def.conventional.length > 0) {
        expect(resolveSeedValue(def, 'female', 'normal', EDAD_ADULTA), def.label).toBeDefined();
      }
    }
  });

  test('cae a otra banda si la preferida no es construible', () => {
    const apob = byId.get('apob')!;
    const resolved = resolveSeedValue(apob, 'male', 'out');
    expect(resolved?.band).toBe('out');
    expect(classifyBiomarkerValue(apob, resolved!.value, 'male').status).toMatch(/high|low/);
  });
});

describe('seedSeries', () => {
  test('serie de longitud N que termina en el valor de la banda final', () => {
    const apob = byId.get('apob')!;
    const series = seedSeries(apob, 'male', 'pX|apob', 5)!;
    expect(series).toHaveLength(5);
    expect(series.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
    const target = resolveSeedValue(apob, 'male', bandForKey('pX|apob'))!;
    expect(series[series.length - 1]).toBe(target.value);
  });

  test('el último valor de la serie es el de la banda final para todas las defs', () => {
    for (const def of defs) {
      if (def.optimal.length === 0 && def.conventional.length === 0) {
        continue;
      }
      const key = `pZ|${def.biomarcadorId}`;
      const series = seedSeries(def, 'female', key, 5, EDAD_ADULTA);
      expect(series, def.label).toBeDefined();
      const expected = resolveSeedValue(def, 'female', bandForKey(key), EDAD_ADULTA)!.value;
      expect(series![series!.length - 1], def.label).toBe(expected);
    }
  });
});

describe('helpers', () => {
  test('roundSeedValue: 1 decimal si <20, entero si no', () => {
    expect(roundSeedValue(5.27)).toBe(5.3);
    expect(roundSeedValue(132.6)).toBe(133);
  });

  test('bandForKey es determinístico y cubre las tres bandas', () => {
    expect(bandForKey('p1|apob')).toBe(bandForKey('p1|apob'));
    const bands = new Set(Array.from({ length: 60 }, (_, i) => bandForKey(`p${i}|x`)));
    expect(bands).toContain('optimal');
    expect(bands).toContain('normal');
    expect(bands).toContain('out');
  });
});

import type { Bundle, ObservationDefinition } from '@medplum/fhirtypes';
import bundleJson from '../../data/ckm/biomarker-definitions.json';
import { bandForKey, resolveSeedValue, roundSeedValue, seedSeries, seedValueFor } from './biomarker-seed';
import {
  classifyBiomarkerValue,
  indexByBiomarcador,
  parseObservationDefinition,
  rangeForGender,
} from './observation-definitions';

const defs = ((bundleJson as unknown as Bundle).entry ?? [])
  .map((e) => e.resource as ObservationDefinition)
  .filter((r) => r?.resourceType === 'ObservationDefinition')
  .map(parseObservationDefinition);
const byId = indexByBiomarcador(defs);

/**
 * Definiciones cuyo rango óptimo cae ENTERAMENTE fuera del convencional. Con
 * rangos así no hay valor que se pueda clasificar de forma coherente, así que
 * quedan afuera de los invariantes de abajo — pero NO en silencio: el test
 * `rangos incoherentes` de más abajo verifica que la lista sea exactamente
 * esta, para que no crezca sin que nadie se entere.
 *
 * Las tres están pendientes de revisión clínica:
 * - Zinc sérico: unidad declarada µg/mL; el convencional (0,6–1,06) está en
 *   µg/mL y el óptimo (90–110) en µg/dL. Falta unificar.
 * - Testosterona Libre: unidad declarada pg/mL; el convencional (38–190) está
 *   en pg/mL y el óptimo (15–25) en ng/dL. Falta unificar.
 * - DHEA-S: convencional 20–300 y óptimo 350–500 µg/dL, sin solapamiento. Ya
 *   viene marcada con la extensión `rango-a-validar` en el catálogo.
 */
const RANGOS_INCOHERENTES = ['zinc', 'testosterona-libre', 'dhea-s'];

const coherentes = defs.filter((d) => !RANGOS_INCOHERENTES.includes(d.biomarcadorId ?? ''));

describe('seedValueFor — cae en la banda pedida (sobre las 109 reales)', () => {
  test('banda "optimal" clasifica como Óptimo en toda def con rango óptimo', () => {
    const withOptimal = coherentes.filter((d) => d.optimal.length > 0);
    expect(withOptimal.length).toBeGreaterThan(0);
    for (const def of withOptimal) {
      const v = seedValueFor(def, 'male', 'optimal');
      expect(v, `${def.label} optimal`).toBeDefined();
      expect(classifyBiomarkerValue(def, v, 'male').status, `${def.label} optimal`).toBe('optimal');
    }
  });

  test('banda "out" clasifica como Alto/Bajo en toda def con rango convencional', () => {
    const withConventional = coherentes.filter((d) => d.conventional.length > 0);
    for (const def of withConventional) {
      const v = seedValueFor(def, 'male', 'out');
      expect(v, `${def.label} out`).toBeDefined();
      expect(['high', 'low'], `${def.label} out`).toContain(classifyBiomarkerValue(def, v, 'male').status);
    }
  });

  test('banda "normal" clasifica como Normal en toda def con brecha construible (male y female)', () => {
    let covered = 0;
    for (const gender of ['male', 'female']) {
      for (const def of coherentes) {
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
  // Si arreglás una de las tres, sacala de RANGOS_INCOHERENTES y este test
  // vuelve a verde. Si aparece una cuarta, este test la delata.
  test('las únicas definiciones con óptimo fuera del convencional son las conocidas', () => {
    const detectadas = defs
      .filter((d) =>
        ['male', 'female'].some((g) => {
          const c = rangeForGender(d.conventional, g);
          const o = rangeForGender(d.optimal, g);
          if (!c || !o) {
            return false;
          }
          return (o.low ?? -Infinity) > (c.high ?? Infinity) || (o.high ?? Infinity) < (c.low ?? -Infinity);
        })
      )
      .map((d) => d.biomarcadorId);
    expect(detectadas.sort()).toStrictEqual([...RANGOS_INCOHERENTES].sort());
  });
});

describe('resolveSeedValue', () => {
  test('siempre resuelve un valor para defs con algún rango', () => {
    for (const def of defs) {
      if (def.optimal.length > 0 || def.conventional.length > 0) {
        expect(resolveSeedValue(def, 'female', 'normal'), def.label).toBeDefined();
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
      const series = seedSeries(def, 'female', key, 5);
      expect(series, def.label).toBeDefined();
      const expected = resolveSeedValue(def, 'female', bandForKey(key))!.value;
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

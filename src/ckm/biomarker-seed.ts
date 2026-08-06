// Generación de valores de demostración para los biomarcadores, ubicados a
// propósito en una banda (óptimo / normal / fuera de rango) según los rangos de
// cada ObservationDefinition, para poblar el panel con todos los estados. Puro
// (sin Medplum): lo usa el script seed-biomarkers-demo y se testea solo.
import { rangeFor } from './observation-definitions';
import type { BiomarkerDefinition } from './observation-definitions';

/** Banda deseada para el valor sembrado. */
export type SeedBand = 'optimal' | 'normal' | 'out';

/** Redondea: 1 decimal para magnitudes chicas (HbA1c, HOMA-IR), entero si no. */
export function roundSeedValue(value: number): number {
  return Math.abs(value) < 20 ? Math.round(value * 10) / 10 : Math.round(value);
}

/**
 * Devuelve un valor que cae en la banda pedida según los rangos del biomarcador
 * (respetando el rango por género y edad), o undefined si esa banda no es construible
 * (ej. no hay rango convencional para generar un "fuera de rango"). Agnóstico a
 * la dirección: usa los límites low/high disponibles.
 */
export function seedValueFor(
  def: BiomarkerDefinition,
  gender: string | undefined,
  band: SeedBand,
  ageYears?: number
): number | undefined {
  const optimal = rangeFor(def.optimal, gender, ageYears);
  const conventional = rangeFor(def.conventional, gender, ageYears);
  const oLo = optimal?.low;
  const oHi = optimal?.high;
  const cLo = conventional?.low;
  const cHi = conventional?.high;

  let raw: number | undefined;
  if (band === 'optimal') {
    if (oLo !== undefined && oHi !== undefined) {
      raw = (oLo + oHi) / 2;
    } else if (oHi !== undefined) {
      raw = oHi * 0.9;
    } else if (oLo !== undefined) {
      raw = oLo * 1.1;
    } else if (cHi !== undefined) {
      raw = cHi * 0.7;
    } else if (cLo !== undefined) {
      raw = cLo * 1.3;
    }
  } else if (band === 'normal') {
    // Dentro del convencional pero fuera del óptimo (necesita una brecha).
    if (oHi !== undefined && cHi !== undefined && cHi > oHi) {
      raw = (oHi + cHi) / 2;
    } else if (oLo !== undefined && cLo !== undefined && cLo < oLo) {
      raw = (oLo + cLo) / 2;
    } else if (cLo !== undefined && cHi !== undefined) {
      raw = (cLo + cHi) / 2;
    }
  } else {
    // Fuera del convencional (alto si hay tope; bajo si solo hay piso).
    //
    // El óptimo puede extenderse más allá del convencional (testosterona libre,
    // T3 libre, DHEA-S): hay que pasar los DOS topes, porque si no el valor
    // "fuera de rango" termina cayendo dentro del óptimo y se clasifica Óptimo.
    const hi = Math.max(cHi ?? Number.NEGATIVE_INFINITY, oHi ?? Number.NEGATIVE_INFINITY);
    const lo = Math.min(cLo ?? Number.POSITIVE_INFINITY, oLo ?? Number.POSITIVE_INFINITY);
    if (cHi !== undefined) {
      raw = hi * 1.25;
    } else if (cLo !== undefined) {
      raw = lo * 0.7;
    } else if (oHi !== undefined) {
      raw = oHi * 1.4;
    } else if (oLo !== undefined) {
      raw = oLo * 0.6;
    }
  }

  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return roundSeedValue(raw);
}

export interface ResolvedSeed {
  value: number;
  band: SeedBand;
}

/**
 * Resuelve un valor para la banda preferida; si no es construible, cae a óptimo
 * y luego a fuera de rango. Devuelve undefined si el biomarcador no tiene rangos
 * usables.
 */
export function resolveSeedValue(
  def: BiomarkerDefinition,
  gender: string | undefined,
  preferred: SeedBand,
  ageYears?: number
): ResolvedSeed | undefined {
  const order: SeedBand[] = [preferred, 'optimal', 'normal', 'out'];
  for (const band of order) {
    const value = seedValueFor(def, gender, band, ageYears);
    if (value !== undefined) {
      return { value, band };
    }
  }
  return undefined;
}

/** Banda determinística por clave (paciente+biomarcador): ~50% óptimo, 30% normal, 20% fuera. */
export function bandForKey(key: string): SeedBand {
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100003;
  }
  const bucket = hash % 10;
  return bucket < 5 ? 'optimal' : bucket < 8 ? 'normal' : 'out';
}

/** Banda de arranque (distinta de la final) para que la serie muestre movimiento. */
function startBandFor(key: string, target: SeedBand): SeedBand {
  let hash = 0;
  for (const char of key) {
    hash = (hash * 17 + char.charCodeAt(0)) % 7919;
  }
  const others = (['optimal', 'normal', 'out'] as SeedBand[]).filter((b) => b !== target);
  return others[hash % others.length];
}

/**
 * Genera una serie temporal (de más viejo a más nuevo) que arranca en una banda
 * y termina exactamente en el valor de la banda final (bandForKey), para que la
 * sparkline muestre una tendencia y el último valor coincida con el del panel.
 * Devuelve undefined si el biomarcador no tiene rangos usables.
 */
export function seedSeries(
  def: BiomarkerDefinition,
  gender: string | undefined,
  key: string,
  points = 5,
  ageYears?: number
): number[] | undefined {
  const target = resolveSeedValue(def, gender, bandForKey(key), ageYears);
  if (!target) {
    return undefined;
  }
  const start = resolveSeedValue(def, gender, startBandFor(key, target.band), ageYears);
  if (!start || points < 2) {
    return [target.value];
  }
  const amplitude = Math.abs(target.value - start.value) * 0.06 + Math.abs(target.value) * 0.005;
  const series: number[] = [];
  for (let k = 0; k < points; k++) {
    const t = k / (points - 1);
    const base = start.value + (target.value - start.value) * t;
    // Jitter determinístico (no en el último punto, que queda exacto).
    const jitter = k === points - 1 ? 0 : Math.sin((k + 1) * 1.7 + key.length) * amplitude;
    series.push(Math.max(0.1, roundSeedValue(base + jitter)));
  }
  series[series.length - 1] = target.value;
  return series;
}

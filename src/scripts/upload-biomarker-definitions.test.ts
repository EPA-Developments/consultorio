import type { Bundle, BundleEntry } from '@medplum/fhirtypes';
import biomarkerBundle from '../../data/ckm/biomarker-definitions.json';
import { partirEnLotes, TAMANO_LOTE } from './upload-biomarker-definitions';

function bundleDe(n: number): Bundle {
  const entry: BundleEntry[] = Array.from({ length: n }, (_, i) => ({
    request: { method: 'PUT', url: `ObservationDefinition/od-${i}` },
    resource: { resourceType: 'ObservationDefinition', id: `od-${i}`, code: { text: `Marcador ${i}` } },
  }));
  return { resourceType: 'Bundle', type: 'transaction', entry };
}

describe('partirEnLotes', () => {
  test('107 entradas -> 3 lotes de 50/50/7 (el caso real del catálogo)', () => {
    const lotes = partirEnLotes(bundleDe(107));
    expect(lotes.map((l) => l.entry?.length)).toEqual([50, 50, 7]);
  });

  test('ningún lote supera el tope que acepta el servidor', () => {
    const lotes = partirEnLotes(bundleDe(107));
    expect(lotes.every((l) => (l.entry?.length ?? 0) <= TAMANO_LOTE)).toBe(true);
  });

  test('no pierde ni reordena entradas', () => {
    const original = bundleDe(107);
    const planas = partirEnLotes(original).flatMap((l) => l.entry ?? []);
    expect(planas).toHaveLength(107);
    expect(planas.map((e) => e.request?.url)).toEqual(original.entry?.map((e) => e.request?.url));
  });

  test('cada lote sigue siendo una transacción (atómico: no deja el catálogo a medias)', () => {
    for (const lote of partirEnLotes(bundleDe(107))) {
      expect(lote.resourceType).toBe('Bundle');
      expect(lote.type).toBe('transaction');
    }
  });

  test('un bundle que entra en el tope va en un solo lote', () => {
    expect(partirEnLotes(bundleDe(50))).toHaveLength(1);
    expect(partirEnLotes(bundleDe(1))).toHaveLength(1);
  });

  test('bundle vacío -> sin lotes (no manda una transacción vacía)', () => {
    expect(partirEnLotes({ resourceType: 'Bundle', type: 'transaction', entry: [] })).toEqual([]);
    expect(partirEnLotes({ resourceType: 'Bundle', type: 'transaction' })).toEqual([]);
  });

  test('el catálogo real se parte sin exceder el tope', () => {
    const real = biomarkerBundle as unknown as Bundle;
    const lotes = partirEnLotes(real);
    expect(lotes.every((l) => (l.entry?.length ?? 0) <= TAMANO_LOTE)).toBe(true);
    // Y no se pierde ninguna definición por el camino.
    expect(lotes.reduce((n, l) => n + (l.entry?.length ?? 0), 0)).toBe(real.entry?.length);
  });
});

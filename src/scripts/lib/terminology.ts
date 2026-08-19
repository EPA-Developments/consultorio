// Helper compartido de terminología para los scripts que publican ValueSets
// curados en el servidor self-hosted (medicación, diagnósticos, alergias).
import type { MedplumClient } from '@medplum/core';
import type { CodeSystem, CodeSystemConcept } from '@medplum/fhirtypes';
import { upsertUnico } from './upsert';

/**
 * Upserta un CodeSystem fragmento por url, MERGEando los conceptos con los que
 * ya existan (unión por code). Así dos ValueSets que comparten el mismo sistema
 * (p. ej. RxNorm en medicación y en alergias) no se pisan los conceptos.
 * Medplum self-hosted necesita el CodeSystem presente para poder expandir/
 * validar los conceptos del ValueSet.
 *
 * @returns la cantidad de conceptos del CodeSystem resultante.
 */
export async function upsertCodeSystemFragment(
  medplum: MedplumClient,
  url: string,
  concepts: CodeSystemConcept[],
  meta?: { name?: string; title?: string }
): Promise<number> {
  const existing = await medplum.searchOne('CodeSystem', `url=${encodeURIComponent(url)}`);
  const byCode = new Map<string, CodeSystemConcept>();
  for (const c of existing?.concept ?? []) {
    if (c.code) {
      byCode.set(c.code, c);
    }
  }
  for (const c of concepts) {
    if (c.code) {
      byCode.set(c.code, c);
    }
  }
  const merged: CodeSystem = {
    resourceType: 'CodeSystem',
    url,
    status: 'active',
    content: 'fragment',
    name: meta?.name ?? existing?.name,
    title: meta?.title ?? existing?.title,
    concept: [...byCode.values()],
  };
  const result = await upsertUnico(medplum, merged, `url=${encodeURIComponent(url)}`);
  return result.concept?.length ?? 0;
}

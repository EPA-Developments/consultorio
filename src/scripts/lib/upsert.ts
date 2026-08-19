// upsert con diagnóstico cuando hay duplicados.
//
// `medplum.upsertResource(recurso, query)` hace un update condicional: si la
// query matchea 0 crea, si matchea 1 actualiza, y si matchea VARIOS el servidor
// rechaza con "Multiple resources found matching condition". Eso último está
// bien —elegir uno al azar sería peor—, pero el error sale como un stack trace
// que no dice qué recurso, cuál era la query ni cuáles son los duplicados.
//
// Pasó con verify-prevent contra un proyecto real: dos Condition con el mismo
// identifier de semilla, y el script murió con cuatro líneas de `at async`.
// Acá se conserva el camino atómico (se intenta el upsert igual) y recién ante
// esa falla puntual se consulta quiénes son, para poder decirlo.
import type { MedplumClient } from '@medplum/core';
import type { Resource, ResourceType } from '@medplum/fhirtypes';

/** El servidor identifica este caso con `outcome.id = 'multiple-matches'`. */
export function esMultipleMatch(err: unknown): boolean {
  const outcome = (err as { outcome?: { id?: string } } | undefined)?.outcome;
  return outcome?.id === 'multiple-matches' || /multiple resources found/i.test(String(err));
}

/** Mensaje accionable: qué recurso, con qué query, cuáles duplicados y qué hacer. */
export function mensajeDuplicados(tipo: string, query: string, ids: string[]): string {
  const lista = ids.length > 0 ? ids.map((id) => `    ${tipo}/${id}`).join('\n') : '    (no se pudieron listar)';
  return (
    `Hay ${ids.length || 'varios'} ${tipo} que matchean «${query}», así que el upsert no sabe cuál actualizar.\n` +
    `  Duplicados:\n${lista}\n` +
    `  Dejá uno solo y volvé a correr. Para verlos en el servidor:\n` +
    `    GET /fhir/R4/${tipo}?${query}`
  );
}

/**
 * Igual que `medplum.upsertResource`, pero cuando la query matchea varios
 * recursos explica cuáles son en vez de tirar el error crudo del servidor.
 */
export async function upsertUnico<T extends Resource>(medplum: MedplumClient, resource: T, query: string): Promise<T> {
  try {
    return await medplum.upsertResource<T>(resource, query);
  } catch (err) {
    if (!esMultipleMatch(err)) {
      throw err;
    }
    const encontrados = await medplum
      .searchResources(resource.resourceType as ResourceType, query)
      .catch(() => [] as Resource[]);
    throw new Error(
      mensajeDuplicados(
        resource.resourceType,
        query,
        encontrados.map((r) => r.id).filter((id): id is string => Boolean(id))
      )
    );
  }
}

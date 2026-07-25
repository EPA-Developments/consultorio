// Higiene de datos en el almacenamiento del navegador (P0 de seguridad).
//
// El buscador recuerda la última búsqueda en localStorage para restaurarla en la
// próxima sesión. El problema: `SearchRequest.filters` puede contener DATOS DE
// SALUD o identificadores del paciente (buscar por apellido, por DNI, por
// referencia a un Patient). localStorage es persistente, no se borra al cerrar
// sesión y queda accesible a cualquiera que use esa misma máquina — un riesgo
// concreto en una computadora compartida de consultorio.
//
// Criterio: persistir SOLO preferencias de presentación (tipo de recurso,
// columnas, orden) y NUNCA los filtros. Se pierde la comodidad de recuperar el
// último filtro; se gana no dejar PHI en el disco del consultorio.
import type { SearchRequest } from '@medplum/core';

/** Parte de una búsqueda que es seguro persistir: sin filtros, sin PHI. */
export type StorableSearch = Pick<SearchRequest, 'resourceType' | 'fields' | 'sortRules'>;

/**
 * Reduce una búsqueda a lo que es seguro guardar en el navegador. Descarta
 * `filters` (puede llevar nombre/DNI/referencias del paciente) y cualquier otro
 * campo no contemplado explícitamente.
 */
export function sanitizeSearchForStorage(search: SearchRequest): StorableSearch {
  return {
    resourceType: search.resourceType,
    ...(search.fields ? { fields: search.fields } : {}),
    ...(search.sortRules ? { sortRules: search.sortRules } : {}),
  };
}

/**
 * Serializa una búsqueda para localStorage, ya sanitizada. Devuelve el JSON
 * listo para `setItem`.
 */
export function serializeSearchForStorage(search: SearchRequest): string {
  return JSON.stringify(sanitizeSearchForStorage(search));
}

/**
 * Lee una búsqueda persistida. Aplica el saneamiento TAMBIÉN a la lectura, para
 * neutralizar los filtros que hayan quedado guardados por versiones anteriores
 * de la app (los datos viejos siguen en el navegador del usuario).
 */
export function parseStoredSearch(raw: string | null): StorableSearch | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as SearchRequest;
    if (!parsed?.resourceType) {
      return undefined;
    }
    return sanitizeSearchForStorage(parsed);
  } catch {
    // Entrada corrupta: se ignora en vez de romper el buscador.
    return undefined;
  }
}

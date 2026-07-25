import { Operator } from '@medplum/core';
import type { SearchRequest } from '@medplum/core';
import { parseStoredSearch, sanitizeSearchForStorage, serializeSearchForStorage } from './search-storage';

const searchConPhi: SearchRequest = {
  resourceType: 'Patient',
  fields: ['name', 'birthDate'],
  sortRules: [{ code: '_lastUpdated', descending: true }],
  filters: [
    { code: 'name', operator: Operator.CONTAINS, value: 'Pérez' },
    { code: 'identifier', operator: Operator.EQUALS, value: '30111222' },
  ],
};

describe('sanitizeSearchForStorage', () => {
  test('descarta los filtros (pueden llevar apellido, DNI o referencias)', () => {
    const safe = sanitizeSearchForStorage(searchConPhi);
    expect(safe).not.toHaveProperty('filters');
    expect(JSON.stringify(safe)).not.toContain('Pérez');
    expect(JSON.stringify(safe)).not.toContain('30111222');
  });

  test('conserva las preferencias de presentación', () => {
    const safe = sanitizeSearchForStorage(searchConPhi);
    expect(safe.resourceType).toBe('Patient');
    expect(safe.fields).toEqual(['name', 'birthDate']);
    expect(safe.sortRules).toEqual([{ code: '_lastUpdated', descending: true }]);
  });

  test('no arrastra campos desconocidos que puedan sumar PHI', () => {
    const conExtras = { ...searchConPhi, total: 'accurate', offset: 20, count: 50 } as SearchRequest;
    expect(Object.keys(sanitizeSearchForStorage(conExtras)).sort()).toEqual(['fields', 'resourceType', 'sortRules']);
  });

  test('omite fields/sortRules cuando no existen (no escribe undefined)', () => {
    const minimal = sanitizeSearchForStorage({ resourceType: 'Task' });
    expect(minimal).toEqual({ resourceType: 'Task' });
  });
});

describe('serializeSearchForStorage', () => {
  test('el JSON persistido nunca contiene los filtros', () => {
    const json = serializeSearchForStorage(searchConPhi);
    expect(json).not.toContain('Pérez');
    expect(json).not.toContain('filters');
  });
});

describe('parseStoredSearch', () => {
  test('neutraliza los filtros guardados por versiones anteriores de la app', () => {
    // Simula lo que quedó en el navegador ANTES de este fix.
    const legacy = JSON.stringify(searchConPhi);
    const parsed = parseStoredSearch(legacy);
    expect(parsed).not.toHaveProperty('filters');
    expect(parsed?.resourceType).toBe('Patient');
  });

  test('tolera entradas vacías o corruptas sin romper el buscador', () => {
    expect(parseStoredSearch(null)).toBeUndefined();
    expect(parseStoredSearch('')).toBeUndefined();
    expect(parseStoredSearch('{no es json')).toBeUndefined();
    expect(parseStoredSearch('{"sinResourceType":1}')).toBeUndefined();
  });
});

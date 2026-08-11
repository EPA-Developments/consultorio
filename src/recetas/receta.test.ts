import type { MedicationRequest } from '@medplum/fhirtypes';
import { buildReceta, groupByReceta, RECETA_SYSTEM, validarReceta } from './receta';
import type { ItemReceta } from './receta';
import { medicamentosDelCatalogo, presentacionesDe } from './catalogo';

const METFORMINA: ItemReceta = {
  dci: 'metformina',
  presentacion: 'comprimidos 500 mg',
  cantidad: 2,
  posologia: '1 comprimido cada 12 h con las comidas, 30 días',
};

const SEMAGLUTIDA: ItemReceta = {
  dci: 'semaglutida',
  presentacion: 'solución inyectable SC 0,25 mg/dosis (pluma prellenada)',
  cantidad: 1,
  posologia: '0,25 mg SC una vez por semana, 4 semanas',
};

describe('Validación de la receta', () => {
  test('una receta completa no tiene problemas', () => {
    expect(validarReceta([METFORMINA], 'Diabetes tipo 2 (E11.9)')).toStrictEqual([]);
  });

  // La ley primero: sin DCI no hay receta, aunque todo lo demás esté.
  test('sin DCI se rechaza, citando la ley', () => {
    const problemas = validarReceta([{ ...METFORMINA, dci: '  ' }], 'DM2');
    expect(problemas.some((p) => p.includes('25.649'))).toBe(true);
  });

  test('sin posología se rechaza: sería una autorización de compra, no una indicación', () => {
    expect(validarReceta([{ ...METFORMINA, posologia: '' }], 'DM2')).toHaveLength(1);
  });

  test('sin diagnóstico se rechaza', () => {
    expect(validarReceta([METFORMINA], '  ').some((p) => p.includes('diagnóstico'))).toBe(true);
  });

  test('la cantidad tiene que ser un entero mayor a cero', () => {
    for (const cantidad of [0, -1, 1.5]) {
      expect(validarReceta([{ ...METFORMINA, cantidad }], 'DM2').length, String(cantidad)).toBeGreaterThan(0);
    }
  });

  test('una receta vacía se rechaza', () => {
    expect(validarReceta([], 'DM2').some((p) => p.includes('ningún medicamento'))).toBe(true);
  });

  // Todos los problemas juntos: el médico corrige una vez, no una vuelta por error.
  test('reporta todos los problemas de una vez', () => {
    const problemas = validarReceta([{ dci: '', presentacion: '', cantidad: 0, posologia: '' }], '');
    expect(problemas.length).toBeGreaterThanOrEqual(4);
  });
});

describe('Construcción de los MedicationRequest', () => {
  const params = {
    subject: { reference: 'Patient/p1' },
    requester: { reference: 'Practitioner/dr1' },
    items: [METFORMINA, SEMAGLUTIDA],
    diagnostico: 'Diabetes tipo 2 (E11.9)',
    recetaId: 'REC-TEST01',
    authoredOn: '2026-08-10T12:00:00Z',
  };
  const requests = buildReceta(params);

  test('un MedicationRequest por ítem, todos de la misma receta', () => {
    expect(requests).toHaveLength(2);
    for (const r of requests) {
      expect(r.groupIdentifier).toStrictEqual({ system: RECETA_SYSTEM, value: 'REC-TEST01' });
      expect(r.status).toBe('active');
      expect(r.intent).toBe('order');
      expect(r.subject?.reference).toBe('Patient/p1');
      expect(r.requester?.reference).toBe('Practitioner/dr1');
    }
  });

  test('el medicamento es la DCI con su presentación', () => {
    expect(requests[0].medicationCodeableConcept?.text).toBe('metformina — comprimidos 500 mg');
  });

  test('posología, cantidad y diagnóstico viajan donde FHIR los espera', () => {
    expect(requests[0].dosageInstruction?.[0]?.text).toContain('cada 12 h');
    expect(requests[0].dispenseRequest?.quantity?.value).toBe(2);
    expect(requests[0].reasonCode?.[0]?.text).toContain('E11.9');
  });

  // Fase 1 del plan SNOMED (docs/VADEMECUM-SNOMED.md): el coding viaja solo
  // cuando el catálogo trae el conceptId de la edición descargada. Sin código,
  // la receta sale como hoy — nunca se inventa uno.
  test('con snomedId el medicamento sale codificado; sin él, solo texto', () => {
    const [conCodigo] = buildReceta({ ...params, items: [{ ...METFORMINA, snomedId: '109081006' }] });
    expect(conCodigo.medicationCodeableConcept?.coding?.[0]).toStrictEqual({
      system: 'http://snomed.info/sct',
      code: '109081006',
      display: 'metformina',
    });
    const [sinCodigo] = buildReceta({ ...params, items: [METFORMINA] });
    expect(sinCodigo.medicationCodeableConcept?.coding).toBeUndefined();
    expect(sinCodigo.medicationCodeableConcept?.text).toContain('metformina');
  });

  // El diagnóstico elegido del índice SUMAR viaja codificado; el texto libre,
  // solo como texto — nunca se inventa un código.
  test('con diagnosticoSnomedId el diagnóstico sale codificado; sin él, solo texto', () => {
    const [conCodigo] = buildReceta({ ...params, diagnosticoSnomedId: '73211009' });
    expect(conCodigo.reasonCode?.[0]?.coding?.[0]).toStrictEqual({
      system: 'http://snomed.info/sct',
      code: '73211009',
      display: 'Diabetes tipo 2 (E11.9)',
    });
    expect(conCodigo.reasonCode?.[0]?.text).toBe('Diabetes tipo 2 (E11.9)');
    const [sinCodigo] = buildReceta(params);
    expect(sinCodigo.reasonCode?.[0]?.coding).toBeUndefined();
  });

  test('la marca sugerida queda como nota sustituible, nunca como el medicamento', () => {
    const [r] = buildReceta({ ...params, items: [{ ...METFORMINA, marcaSugerida: 'Glucophage' }] });
    expect(r.medicationCodeableConcept?.text).not.toContain('Glucophage');
    expect(r.note?.[0]?.text).toContain('puede sustituirse');
  });

  test('sin marca ni nota, note queda ausente (no un array vacío)', () => {
    expect(requests[0].note).toBeUndefined();
  });
});

describe('Agrupado por receta', () => {
  test('agrupa por groupIdentifier', () => {
    const a: MedicationRequest[] = buildReceta({
      subject: { reference: 'Patient/p1' },
      items: [METFORMINA],
      diagnostico: 'DM2',
      recetaId: 'REC-A',
      authoredOn: '2026-08-10T12:00:00Z',
    });
    const b: MedicationRequest[] = buildReceta({
      subject: { reference: 'Patient/p1' },
      items: [SEMAGLUTIDA, METFORMINA],
      diagnostico: 'DM2',
      recetaId: 'REC-B',
      authoredOn: '2026-08-10T13:00:00Z',
    });
    const grupos = groupByReceta([...a, ...b]);
    expect(grupos.get('REC-A')).toHaveLength(1);
    expect(grupos.get('REC-B')).toHaveLength(2);
  });
});

describe('El catálogo de conveniencia', () => {
  test('toda entrada tiene DCI y al menos una presentación', () => {
    for (const m of medicamentosDelCatalogo()) {
      expect(m.dci.trim()).toBeTruthy();
      expect(m.presentaciones.length).toBeGreaterThan(0);
    }
  });

  // La posología es una decisión clínica por paciente, no un dato de catálogo.
  test('el catálogo NO trae posologías', () => {
    const texto = JSON.stringify(medicamentosDelCatalogo());
    expect(texto).not.toMatch(/posolog/i);
  });

  // Constancia de la restricción del médico responsable sobre los GLP-1:
  // el catálogo prescribe por DCI, sin marcas.
  test('el catálogo no menciona marcas comerciales', () => {
    const texto = JSON.stringify(medicamentosDelCatalogo()).toLowerCase();
    for (const marca of ['ozempic', 'wegovy', 'mounjaro', 'saxenda', 'glucophage']) {
      expect(texto).not.toContain(marca);
    }
  });

  test('las presentaciones se buscan por DCI', () => {
    expect(presentacionesDe('metformina').length).toBeGreaterThan(0);
    expect(presentacionesDe('inexistente')).toStrictEqual([]);
  });
});

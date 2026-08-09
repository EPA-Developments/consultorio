import { CLASES_ENCUENTRO, TIPOS_ENCUENTRO } from './encounter-coding';

// El desplegable escribe estos codings dentro del Encounter. Un system mal
// puesto no rompe nada visible: la evolución se guarda igual y el código queda
// sin significado, que es peor que un error.
describe('Codificación del encuentro', () => {
  test('las clases usan el CodeSystem de HL7 v3-ActCode', () => {
    for (const o of CLASES_ENCUENTRO) {
      expect(o.valueCoding?.system).toBe('http://terminology.hl7.org/CodeSystem/v3-ActCode');
    }
  });

  test('los tipos usan SNOMED', () => {
    for (const o of TIPOS_ENCUENTRO) {
      expect(o.valueCoding?.system).toBe('http://snomed.info/sct');
    }
  });

  test('toda opción tiene código y texto para mostrar', () => {
    for (const o of [...CLASES_ENCUENTRO, ...TIPOS_ENCUENTRO]) {
      expect(o.valueCoding?.code).toBeTruthy();
      expect(o.valueCoding?.display).toBeTruthy();
    }
  });

  test('no hay códigos repetidos', () => {
    for (const lista of [CLASES_ENCUENTRO, TIPOS_ENCUENTRO]) {
      const codes = lista.map((o) => o.valueCoding?.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  // Lo que se lee tiene que estar en castellano: el formulario es la pantalla
  // que más ve el médico y venía entero en inglés.
  test('los textos están en castellano', () => {
    const displays = [...CLASES_ENCUENTRO, ...TIPOS_ENCUENTRO].map((o) => o.valueCoding?.display as string);
    expect(displays).toContain('Ambulatorio (consultorio)');
    expect(displays).toContain('Control de seguimiento');
    // Ningún resto del ValueSet original del template.
    expect(displays.some((d) => /Consultation|Follow-up|Home visit/i.test(d))).toBe(false);
  });

  // Los tipos salen de data/core/encounter-types.json; no se inventó ninguno.
  test('los códigos SNOMED son los del catálogo del proyecto', () => {
    const delCatalogo = new Set([
      '11429006',
      '308540004',
      '371883000',
      '185317003',
      '439708006',
      '390906007',
      '50849002',
      '255327002',
      '110466009',
      '91251008',
      '31205005',
      '163497009',
      '83607001',
      '225362009',
      '304567001',
    ]);
    for (const o of TIPOS_ENCUENTRO) {
      expect(delCatalogo.has(o.valueCoding?.code as string), o.valueCoding?.display).toBe(true);
    }
  });
});

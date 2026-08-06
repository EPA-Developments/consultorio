import { assessGLP1, metabolicPhenotype, PROTOCOL_VERIFIED, suggestMolecules, UMBRALES } from './eligibility';
import type { GLP1Inputs } from './eligibility';

/** Paciente base: 52 años, sin antecedentes, con todos los datos cargados. */
function paciente(extra: Partial<GLP1Inputs> = {}): GLP1Inputs {
  return {
    ageYears: 52,
    sex: 'male',
    bmi: 24,
    waistCm: 85,
    hba1cPercent: 5.2,
    fastingGlucoseMgDl: 88,
    homaIr: 1.4,
    egfr: 95,
    ...extra,
  };
}

describe('Estado del protocolo', () => {
  test('está marcado como NO validado hasta la firma del referente clínico', () => {
    // Si alguien lo pone en true sin validación clínica, este test lo frena.
    expect(PROTOCOL_VERIFIED).toBe(false);
  });
});

describe('Fenotipo metabólico', () => {
  test('DM2 por HbA1c ≥ 6.5', () => {
    expect(metabolicPhenotype(paciente({ hba1cPercent: 7.1 }))).toBe('dm2');
  });

  test('DM2 por diagnóstico previo aunque la HbA1c esté controlada', () => {
    expect(metabolicPhenotype(paciente({ hasT2D: true, hba1cPercent: 6.1 }))).toBe('dm2');
  });

  test('prediabetes por HbA1c 5.7–6.4', () => {
    expect(metabolicPhenotype(paciente({ hba1cPercent: 6.0 }))).toBe('prediabetes');
  });

  test('prediabetes por glucemia en ayunas 100–125', () => {
    expect(metabolicPhenotype(paciente({ fastingGlucoseMgDl: 112 }))).toBe('prediabetes');
  });

  // El caso más frecuente de la población BioWellness: HOMA alto con glucemia
  // todavía normal. Si solo se mirara glucemia, se perdería.
  test('resistencia insulínica con glucemia y HbA1c normales', () => {
    expect(metabolicPhenotype(paciente({ homaIr: 3.4 }))).toBe('resistencia-insulinica');
  });

  test('hiperinsulinemia por insulina basal alta, sin HOMA cargado', () => {
    expect(metabolicPhenotype(paciente({ homaIr: undefined, fastingInsulinUUmL: 18 }))).toBe('resistencia-insulinica');
  });

  test('exceso de peso sin disglucemia', () => {
    expect(metabolicPhenotype(paciente({ bmi: 31 }))).toBe('obesidad-sin-disglucemia');
  });

  test('paciente sano: sin alteración', () => {
    expect(metabolicPhenotype(paciente())).toBe('sin-alteracion');
  });

  test('sin ningún dato metabólico no afirma "sano"', () => {
    expect(
      metabolicPhenotype({ ageYears: 50, bmi: undefined, hba1cPercent: undefined, fastingGlucoseMgDl: undefined })
    ).toBe('datos-insuficientes');
  });

  test('gana el fenotipo más severo (DM2 sobre resistencia insulínica)', () => {
    expect(metabolicPhenotype(paciente({ hba1cPercent: 7.2, homaIr: 5 }))).toBe('dm2');
  });
});

describe('Contraindicaciones absolutas', () => {
  test('CMT/NEM2 bloquea aunque cumpla todos los criterios', () => {
    const r = assessGLP1(paciente({ bmi: 34, hba1cPercent: 7.5, hasMTCorMEN2: true }));
    expect(r.candidacy).toBe('no-candidato');
    expect(r.blockers[0].text).toContain('carcinoma medular');
  });

  test('embarazo o búsqueda bloquea', () => {
    expect(assessGLP1(paciente({ bmi: 33, isPregnantOrPlanning: true })).candidacy).toBe('no-candidato');
  });

  test('diabetes tipo 1 bloquea', () => {
    expect(assessGLP1(paciente({ bmi: 33, hasType1Diabetes: true })).candidacy).toBe('no-candidato');
  });

  test('con contraindicación NO se sugiere ninguna molécula', () => {
    const r = assessGLP1(paciente({ bmi: 34, hasMTCorMEN2: true }));
    expect(r.molecules).toHaveLength(0);
  });
});

describe('Precauciones', () => {
  test('insulina o sulfonilurea: advierte hipoglucemia', () => {
    const r = assessGLP1(paciente({ bmi: 32, hasT2D: true, onInsulin: true }));
    expect(r.cautions.some((c) => c.text.includes('hipoglucemia'))).toBe(true);
    expect(r.candidacy).not.toBe('no-candidato'); // precaución, no bloqueo
  });

  test('pancreatitis previa advierte pero no bloquea', () => {
    const r = assessGLP1(paciente({ bmi: 33, hasPancreatitisHistory: true }));
    expect(r.cautions.some((c) => c.text.includes('pancreatitis'))).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  test('≥60 años: alerta de preservación de masa magra', () => {
    const r = assessGLP1(paciente({ ageYears: 67, bmi: 32 }));
    expect(r.cautions.some((c) => c.text.includes('masa magra'))).toBe(true);
  });

  test('retinopatía: advierte por corrección glucémica rápida', () => {
    const r = assessGLP1(paciente({ bmi: 32, hasT2D: true, hasRetinopathy: true }));
    expect(r.cautions.some((c) => c.text.includes('Retinopatía'))).toBe(true);
  });
});

describe('Candidatura', () => {
  test('paciente sano sin criterios: no candidato', () => {
    const r = assessGLP1(paciente());
    expect(r.candidacy).toBe('no-candidato');
    expect(r.rationale).toHaveLength(0);
  });

  test('obesidad con datos completos: candidato', () => {
    const r = assessGLP1(paciente({ bmi: 33, waistCm: 104 }));
    expect(r.candidacy).toBe('candidato');
    expect(r.rationale.some((x) => x.text.includes('IMC'))).toBe(true);
  });

  test('con criterios pero faltando datos: "posible", no "candidato"', () => {
    const r = assessGLP1({ ageYears: 55, sex: 'male', bmi: 33 });
    expect(r.candidacy).toBe('posible');
    expect(r.missingData.length).toBeGreaterThan(0);
  });

  test('sin ningún dato: datos insuficientes', () => {
    expect(assessGLP1({ ageYears: 50 }).candidacy).toBe('datos-insuficientes');
  });

  test('IMC 27–30 requiere comorbilidad para sumar criterio', () => {
    const sinComorbilidad = assessGLP1(paciente({ bmi: 28, waistCm: 80 }));
    expect(sinComorbilidad.rationale.some((x) => x.text.includes('IMC'))).toBe(false);

    const conComorbilidad = assessGLP1(paciente({ bmi: 28, waistCm: 80, hba1cPercent: 6.0 }));
    expect(conComorbilidad.rationale.some((x) => x.text.includes('IMC'))).toBe(true);
  });

  test('cintura usa el umbral IDF de Sudamérica, no el de ATP III', () => {
    // Mujer con 82 cm: supera el umbral IDF (80) aunque no el de ATP III (88).
    const r = assessGLP1(paciente({ sex: 'female', waistCm: 82, bmi: 26 }));
    expect(r.rationale.some((x) => x.text.includes('Cintura'))).toBe(true);
    expect(UMBRALES.cinturaMujer).toBe(80);
  });
});

describe('Selección de molécula', () => {
  test('ERC o albuminuria prioriza semaglutida (FLOW)', () => {
    const s = suggestMolecules(paciente({ egfr: 48, uacrMgG: 60, bmi: 32 }), 'dm2');
    expect(s[0].molecule).toBe('Semaglutida');
    expect(s[0].evidence).toContain('FLOW');
  });

  test('riesgo CV alto sin diabetes prioriza semaglutida (SELECT)', () => {
    const s = suggestMolecules(paciente({ hasASCVD: true, bmi: 32 }), 'obesidad-sin-disglucemia');
    expect(s[0].molecule).toBe('Semaglutida');
    expect(s[0].evidence).toContain('SELECT');
  });

  test('objetivo ponderal máximo sugiere tirzepatida (SURMOUNT)', () => {
    const s = suggestMolecules(paciente({ bmi: 36 }), 'obesidad-sin-disglucemia');
    expect(s.some((x) => x.molecule === 'Tirzepatida' && x.evidence.includes('SURMOUNT'))).toBe(true);
  });

  test('no repite la misma molécula aunque apliquen varias reglas', () => {
    const s = suggestMolecules(paciente({ hasASCVD: true, egfr: 50, uacrMgG: 40, bmi: 33 }), 'dm2');
    expect(new Set(s.map((x) => x.molecule)).size).toBe(s.length);
  });

  test('sugiere principio activo (DCI), nunca marca comercial', () => {
    const s = suggestMolecules(paciente({ bmi: 34, hasASCVD: true }), 'dm2');
    const texto = JSON.stringify(s);
    for (const marca of ['Ozempic', 'Wegovy', 'Mounjaro', 'Zepbound', 'Saxenda', 'Trulicity']) {
      expect(texto).not.toContain(marca);
    }
  });
});

describe('Casos clínicos reales de la población BioWellness', () => {
  test('55 años, HOMA 3.2, glucemia 96, IMC 29, cintura 98 → candidato', () => {
    const r = assessGLP1({
      ageYears: 55,
      sex: 'male',
      bmi: 29,
      waistCm: 98,
      hba1cPercent: 5.5,
      fastingGlucoseMgDl: 96,
      homaIr: 3.2,
      egfr: 88,
    });
    expect(r.phenotype).toBe('resistencia-insulinica');
    expect(r.candidacy).toBe('candidato');
    expect(r.molecules.length).toBeGreaterThan(0);
  });

  test('48 años, DM2 medicada con insulina, ERC leve → candidato con dos precauciones', () => {
    const r = assessGLP1({
      ageYears: 48,
      sex: 'female',
      bmi: 34,
      waistCm: 96,
      hba1cPercent: 8.1,
      fastingGlucoseMgDl: 165,
      homaIr: 6.0,
      egfr: 52,
      uacrMgG: 85,
      hasT2D: true,
      onInsulin: true,
    });
    expect(r.phenotype).toBe('dm2');
    expect(r.candidacy).toBe('candidato');
    expect(r.cautions.some((c) => c.text.includes('hipoglucemia'))).toBe(true);
    expect(r.molecules[0].evidence).toContain('FLOW'); // manda la rama renal
  });

  test('44 años sin alteraciones → no candidato, y lo dice sin ambigüedad', () => {
    const r = assessGLP1(paciente({ ageYears: 44, bmi: 23, waistCm: 82, homaIr: 1.2 }));
    expect(r.candidacy).toBe('no-candidato');
    expect(r.molecules).toHaveLength(0);
    expect(r.blockers).toHaveLength(0); // no candidato por ausencia de criterios, no por contraindicación
  });
});

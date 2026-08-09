import type { Encounter, Observation, Practitioner, QuestionnaireResponse } from '@medplum/fhirtypes';
import { LOINC, LOINC_BP_PANEL } from '../ckm/constants';
import { LOINC_PESO, LOINC_TALLA, NOTA_EVOLUCION, NOTA_EVOLUCION_URL, recursosDeLaNota } from './nota-evolucion';

const ENCUENTRO: Encounter = {
  resourceType: 'Encounter',
  id: 'enc1',
  status: 'in-progress',
  class: { code: 'AMB' },
  subject: { reference: 'Patient/p1' },
  period: { start: '2026-08-09T14:00:00Z' },
};

const MEDICA: Practitioner = { resourceType: 'Practitioner', id: 'dra1' };

function respuesta(items: Record<string, number | string>): QuestionnaireResponse {
  return {
    resourceType: 'QuestionnaireResponse',
    status: 'in-progress',
    item: Object.entries(items).map(([linkId, v]) => ({
      linkId,
      answer: [typeof v === 'number' ? { valueQuantity: { value: v } } : { valueString: v }],
    })),
  };
}

/** Recursos de un tipo dentro del bundle. */
function delTipo<T>(bundle: ReturnType<typeof recursosDeLaNota>, tipo: string): T[] {
  return (bundle.entry ?? []).map((e) => e.resource).filter((r) => r?.resourceType === tipo) as T[];
}

function observacionPorCodigo(bundle: ReturnType<typeof recursosDeLaNota>, code: string): Observation | undefined {
  return delTipo<Observation>(bundle, 'Observation').find((o) => o.code?.coding?.[0]?.code === code);
}

const NOTA_COMPLETA = {
  motivo: 'Control de seguimiento',
  evolucion: 'Paciente estable, buena adherencia.',
  plan: 'Repetir laboratorio en 12 semanas.',
  sistolica: 128,
  diastolica: 82,
  peso: 81.5,
  talla: 178,
  cintura: 94,
};

describe('El cuestionario embebido', () => {
  test('no depende de ningún recurso del servidor', () => {
    // Ni answerValueSet ni referencias externas: todo lo que el formulario
    // necesita está en la constante. Este test fija la decisión.
    const texto = JSON.stringify(NOTA_EVOLUCION);
    expect(texto).not.toContain('answerValueSet');
    expect(texto).not.toContain('example.com');
  });

  test('está en castellano', () => {
    expect(NOTA_EVOLUCION.title).toBe('Nota de evolución');
    expect(JSON.stringify(NOTA_EVOLUCION)).not.toMatch(/Reason for visit|Date of Visit|Assessment/);
  });
});

describe('La transacción de la nota', () => {
  const bundle = recursosDeLaNota(respuesta(NOTA_COMPLETA), ENCUENTRO, MEDICA);

  test('es una transacción: o entra todo o no entra nada', () => {
    expect(bundle.type).toBe('transaction');
  });

  test('la respuesta viaja en el mismo bundle, completada', () => {
    const [r] = delTipo<QuestionnaireResponse>(bundle, 'QuestionnaireResponse');
    expect(r.encounter?.reference).toBe('Encounter/enc1');
    expect(r.subject?.reference).toBe('Patient/p1');
    expect(r.status).toBe('completed');
    expect(r.questionnaire).toBe(NOTA_EVOLUCION_URL);
    expect(r.author?.reference).toBe('Practitioner/dra1');
  });

  // El bot del template guardaba la PA como 35094-2, que ninguna lectura del
  // stack CKM incluye: el médico cargaba la presión y PREVENT no la veía.
  test('la presión arterial sale como panel 85354-9 con componentes, la forma que lee el CKM', () => {
    const pa = observacionPorCodigo(bundle, LOINC_BP_PANEL);
    expect(pa).toBeDefined();
    const codigos = pa?.component?.map((c) => c.code?.coding?.[0]?.code);
    expect(codigos).toStrictEqual([LOINC.sbp, LOINC.dbp]);
    expect(pa?.component?.[0]?.valueQuantity?.value).toBe(128);
  });

  test('peso, talla y cintura usan los códigos que GLP-1 y CKM ya leen', () => {
    expect(observacionPorCodigo(bundle, LOINC_PESO)?.valueQuantity?.value).toBe(81.5);
    expect(observacionPorCodigo(bundle, LOINC_TALLA)?.valueQuantity?.value).toBe(178);
    expect(observacionPorCodigo(bundle, LOINC.waist)?.valueQuantity?.value).toBe(94);
  });

  test('el IMC se deriva de peso y talla', () => {
    // 81.5 / 1.78² = 25.72... → 25.7
    expect(observacionPorCodigo(bundle, LOINC.bmi)?.valueQuantity?.value).toBe(25.7);
  });

  test('las observaciones quedan ancladas al encuentro, al paciente y a la fecha', () => {
    for (const o of delTipo<Observation>(bundle, 'Observation')) {
      expect(o.subject?.reference).toBe('Patient/p1');
      expect(o.encounter?.reference).toBe('Encounter/enc1');
      expect(o.effectiveDateTime).toBe('2026-08-09T14:00:00Z');
      expect(o.performer?.[0]?.reference).toBe('Practitioner/dra1');
      expect(o.status).toBe('final');
    }
  });

  test('la evolución y el plan quedan como impresión clínica', () => {
    const [ci] = delTipo<{ description?: string; summary?: string }>(bundle, 'ClinicalImpression');
    expect(ci.description).toBe('Control de seguimiento');
    expect(ci.summary).toContain('Paciente estable');
    expect(ci.summary).toContain('Plan: Repetir laboratorio');
  });
});

describe('Notas parciales', () => {
  test('sin signos vitales no se inventan observaciones', () => {
    const bundle = recursosDeLaNota(respuesta({ motivo: 'Consulta', evolucion: 'Sin cambios.' }), ENCUENTRO, MEDICA);
    expect(delTipo<Observation>(bundle, 'Observation')).toStrictEqual([]);
    expect(delTipo(bundle, 'ClinicalImpression').length).toBe(1);
  });

  test('solo la sistólica: el panel sale con un componente, no con uno inventado', () => {
    const bundle = recursosDeLaNota(respuesta({ motivo: 'x', evolucion: 'y', sistolica: 140 }), ENCUENTRO, MEDICA);
    const pa = observacionPorCodigo(bundle, LOINC_BP_PANEL);
    expect(pa?.component?.length).toBe(1);
    expect(pa?.component?.[0]?.code?.coding?.[0]?.code).toBe(LOINC.sbp);
  });

  test('peso sin talla: no hay IMC (calcularlo sería inventarlo)', () => {
    const bundle = recursosDeLaNota(respuesta({ motivo: 'x', evolucion: 'y', peso: 80 }), ENCUENTRO, MEDICA);
    expect(observacionPorCodigo(bundle, LOINC.bmi)).toBeUndefined();
    expect(observacionPorCodigo(bundle, LOINC_PESO)).toBeDefined();
  });

  test('sin profesional (perfil no-Practitioner) la nota sale sin performer, no rota', () => {
    const bundle = recursosDeLaNota(respuesta(NOTA_COMPLETA), ENCUENTRO, undefined);
    const [r] = delTipo<QuestionnaireResponse>(bundle, 'QuestionnaireResponse');
    expect(r.author).toBeUndefined();
    for (const o of delTipo<Observation>(bundle, 'Observation')) {
      expect(o.performer).toBeUndefined();
    }
  });

  test('sin fecha del encuentro usa el momento actual en vez de romper', () => {
    const sinFecha = { ...ENCUENTRO, period: undefined };
    const bundle = recursosDeLaNota(respuesta(NOTA_COMPLETA), sinFecha, MEDICA);
    const pa = observacionPorCodigo(bundle, LOINC_BP_PANEL);
    expect(pa?.effectiveDateTime).toBeTruthy();
  });
});

describe('Las unidades salen en UCUM', () => {
  const bundle = recursosDeLaNota(respuesta(NOTA_COMPLETA), ENCUENTRO, MEDICA);

  test('mmHg para la presión, kg para el peso, cm para cintura', () => {
    const pa = observacionPorCodigo(bundle, LOINC_BP_PANEL);
    expect(pa?.component?.[0]?.valueQuantity?.code).toBe('mm[Hg]');
    expect(observacionPorCodigo(bundle, LOINC_PESO)?.valueQuantity?.code).toBe('kg');
    expect(observacionPorCodigo(bundle, LOINC.waist)?.valueQuantity?.code).toBe('cm');
    expect(observacionPorCodigo(bundle, LOINC.bmi)?.valueQuantity?.code).toBe('kg/m2');
  });
});

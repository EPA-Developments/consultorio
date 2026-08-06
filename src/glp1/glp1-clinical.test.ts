import type { Condition, MedicationRequest } from '@medplum/fhirtypes';
import { computeHomaIr, glp1ConditionFlags, glp1MedicationFlags } from './glp1-clinical';

function cond(code: string): Condition {
  return {
    resourceType: 'Condition',
    subject: { reference: 'Patient/p1' },
    clinicalStatus: { coding: [{ code: 'active' }] },
    code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code }] },
  };
}

function med(text: string): MedicationRequest {
  return {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    subject: { reference: 'Patient/p1' },
    medicationCodeableConcept: { text },
  };
}

describe('Antecedentes relevantes para GLP-1', () => {
  test('detecta neoplasia de tiroides y NEM2', () => {
    expect(glp1ConditionFlags([cond('C73')]).hasMTCorMEN2).toBe(true);
    expect(glp1ConditionFlags([cond('E31.2')]).hasMTCorMEN2).toBe(true);
  });

  test('detecta pancreatitis aguda y crónica', () => {
    expect(glp1ConditionFlags([cond('K85.9')]).hasPancreatitisHistory).toBe(true);
    expect(glp1ConditionFlags([cond('K86.1')]).hasPancreatitisHistory).toBe(true);
  });

  test('detecta embarazo', () => {
    expect(glp1ConditionFlags([cond('O24.4')]).isPregnantOrPlanning).toBe(true);
    expect(glp1ConditionFlags([cond('Z34.0')]).isPregnantOrPlanning).toBe(true);
  });

  test('detecta diabetes tipo 1 y no la confunde con tipo 2', () => {
    expect(glp1ConditionFlags([cond('E10.9')]).hasType1Diabetes).toBe(true);
    expect(glp1ConditionFlags([cond('E11.9')]).hasType1Diabetes).toBe(false);
  });

  test('detecta retinopatía diabética', () => {
    expect(glp1ConditionFlags([cond('E11.3')]).hasRetinopathy).toBe(true);
  });

  test('sin antecedentes: todo en false', () => {
    const f = glp1ConditionFlags([cond('I10')]);
    expect(Object.values(f).every((v) => v === false)).toBe(true);
  });
});

describe('Medicación relevante para GLP-1', () => {
  test('detecta insulinas por principio activo', () => {
    expect(glp1MedicationFlags([med('Insulina glargina 100 UI/mL')]).onInsulin).toBe(true);
    expect(glp1MedicationFlags([med('Insulin degludec')]).onInsulin).toBe(true);
  });

  // Trampa real: el texto "resistencia a la insulina" no es una insulina.
  test('NO confunde "resistencia a la insulina" con estar insulinizado', () => {
    expect(glp1MedicationFlags([med('Metformina por resistencia a la insulina')]).onInsulin).toBe(false);
  });

  test('detecta sulfonilureas', () => {
    expect(glp1MedicationFlags([med('Glimepirida 2 mg')]).onSulfonylurea).toBe(true);
  });

  test('detecta que ya recibe un GLP-1', () => {
    expect(glp1MedicationFlags([med('Semaglutida 0,5 mg semanal')]).onGLP1).toBe(true);
    expect(glp1MedicationFlags([med('Tirzepatida 5 mg')]).onGLP1).toBe(true);
  });

  test('metformina sola no activa ninguna bandera', () => {
    const f = glp1MedicationFlags([med('Metformina 850 mg')]);
    expect(f.onInsulin).toBe(false);
    expect(f.onSulfonylurea).toBe(false);
    expect(f.onGLP1).toBe(false);
  });
});

describe('HOMA-IR calculado', () => {
  test('aplica la fórmula (glucosa × insulina) / 405', () => {
    // 96 × 14 / 405 = 3.318…
    expect(computeHomaIr(96, 14)).toBe(3.32);
  });

  test('sin alguno de los dos valores no inventa un resultado', () => {
    expect(computeHomaIr(96, undefined)).toBeUndefined();
    expect(computeHomaIr(undefined, 14)).toBeUndefined();
  });
});

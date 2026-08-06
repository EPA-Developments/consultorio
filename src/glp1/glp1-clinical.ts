// Detección de los antecedentes y la medicación que le importan a la evaluación
// GLP-1, desde Conditions y MedicationRequests. Mismo patrón que ckm/clinical.ts:
// las Conditions se matchean por CÓDIGO (ICD-10) y la medicación por TEXTO del
// principio activo, porque no siempre viene codificada.
//
// Puro y testeable: el fetch vive en el hook.
import type { Condition, MedicationRequest } from '@medplum/fhirtypes';
import { conditionMatches } from '../ckm/clinical';

// ── Antecedentes (ICD-10) ───────────────────────────────────────────────────

/** Neoplasia de tiroides (C73) y neoplasia endocrina múltiple (E31.2). */
export const MTC_MEN2_ICD10 = /^(C73|E31\.2)/;
/** Pancreatitis aguda (K85) y crónica (K86.0, K86.1). */
export const PANCREATITIS_ICD10 = /^(K85|K86\.[01])/;
/** Embarazo, parto y puerperio (O00–O9A) + supervisión del embarazo (Z33, Z34). */
export const PREGNANCY_ICD10 = /^(O[0-9]|Z3[34])/;
/** Gastroparesia (K31.84). */
export const GASTROPARESIS_ICD10 = /^K31\.84/;
/** Colelitiasis (K80) y colecistitis (K81). */
export const GALLBLADDER_ICD10 = /^K8[01]/;
/** Retinopatía diabética: complicación oftálmica de la diabetes (E1x.3) y H36. */
export const RETINOPATHY_ICD10 = /^(E1[0-4]\.3|H36)/;
/** Diabetes tipo 1 (E10). */
export const TYPE1_DIABETES_ICD10 = /^E10/;

// ── Medicación (texto del principio activo) ─────────────────────────────────

/** Insulinas. Se excluye "insulina" a secas para no capturar "resistencia a la insulina". */
export const INSULIN_TEXT =
  /insulina (glargina|detemir|degludec|lispro|aspart|glulisina|nph|corriente|humana)|insulin (glargine|detemir|degludec|lispro|aspart)/;
/** Sulfonilureas: el otro fármaco que obliga a bajar dosis por hipoglucemia. */
export const SULFONYLUREA_TEXT = /glibenclamida|glimepirida|gliclazida|glipizida|glyburide|glimepiride|gliclazide/;
/** Agonistas GLP-1 y GIP/GLP-1, por DCI (no por marca comercial). */
export const GLP1_TEXT =
  /semaglutida|semaglutide|tirzepatida|tirzepatide|liraglutida|liraglutide|dulaglutida|dulaglutide|exenatida|exenatide/;

function medicationText(medications: MedicationRequest[]): string {
  return medications
    .map((m) => m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? '')
    .join(' ')
    .toLowerCase();
}

/** Antecedentes relevantes para GLP-1, a partir de las Conditions ACTIVAS. */
export function glp1ConditionFlags(activeConditions: Condition[]): {
  hasMTCorMEN2: boolean;
  hasPancreatitisHistory: boolean;
  isPregnantOrPlanning: boolean;
  hasSevereGastroparesis: boolean;
  hasGallbladderDisease: boolean;
  hasRetinopathy: boolean;
  hasType1Diabetes: boolean;
} {
  const some = (pattern: RegExp): boolean => activeConditions.some((c) => conditionMatches(c, pattern));
  return {
    hasMTCorMEN2: some(MTC_MEN2_ICD10),
    hasPancreatitisHistory: some(PANCREATITIS_ICD10),
    isPregnantOrPlanning: some(PREGNANCY_ICD10),
    hasSevereGastroparesis: some(GASTROPARESIS_ICD10),
    hasGallbladderDisease: some(GALLBLADDER_ICD10),
    hasRetinopathy: some(RETINOPATHY_ICD10),
    hasType1Diabetes: some(TYPE1_DIABETES_ICD10),
  };
}

/** Medicación relevante para GLP-1 (hipoglucemia y tratamiento ya iniciado). */
export function glp1MedicationFlags(medications: MedicationRequest[]): {
  onInsulin: boolean;
  onSulfonylurea: boolean;
  onGLP1: boolean;
} {
  const texto = medicationText(medications);
  return {
    onInsulin: INSULIN_TEXT.test(texto),
    onSulfonylurea: SULFONYLUREA_TEXT.test(texto),
    onGLP1: GLP1_TEXT.test(texto),
  };
}

/**
 * HOMA-IR = (glucemia en ayunas mg/dL × insulina basal µU/mL) / 405.
 * Se calcula solo si NO vino medido, para no pisar el valor del laboratorio.
 */
export function computeHomaIr(fastingGlucoseMgDl?: number, fastingInsulinUUmL?: number): number | undefined {
  if (fastingGlucoseMgDl === undefined || fastingInsulinUUmL === undefined) {
    return undefined;
  }
  return Math.round(((fastingGlucoseMgDl * fastingInsulinUUmL) / 405) * 100) / 100;
}

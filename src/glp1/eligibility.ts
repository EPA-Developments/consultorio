// Motor de elegibilidad para agonistas GLP-1 / GIP-GLP-1 — Camino CKM → GLP-1.
//
// QUÉ ES Y QUÉ NO ES
// Es SOPORTE A LA DECISIÓN, de solo lectura: fenotipa al paciente con los datos
// que ya están cargados, dice si hay criterios de candidatura, marca las
// contraindicaciones y precauciones, y sugiere moléculas con la evidencia que
// las respalda. NO prescribe, NO calcula dosis y NO reemplaza el juicio clínico.
//
// POR QUÉ ES DETERMINÍSTICO Y NO UNA IA
// Cada salida sale de una regla explícita y citable, igual que el motor PREVENT
// y el estadío CKM. Así es auditable (se puede mostrar la regla y el paper) y
// reproducible (el mismo paciente da siempre lo mismo). El Decreto 98/23 exige
// que la IA en salud sea "de apoyo únicamente, bajo supervisión profesional":
// un motor de protocolo con aprobación médica es defendible; un modelo
// decidiendo un inyectable, no.
//
// ⚠️ ESTADO: PROTOCOLO PROVISIONAL. Los umbrales y el árbol de selección de
// molécula están tomados de la evidencia citada en cada regla, pero NO fueron
// validados aún por el referente clínico (Dr. Diego Aizenberg). Hasta que eso
// ocurra, `PROTOCOL_VERIFIED` es false y la UI debe mostrarlo como borrador.
import type { CKMStage } from '../ckm/types';

/**
 * Flag de validación clínica del protocolo. Mismo criterio que PREVENT_VERIFIED:
 * mientras sea false, la interfaz tiene que declarar que es un borrador sin
 * validar. NO cambiar sin la firma del referente clínico.
 */
export const PROTOCOL_VERIFIED = false;

export const PROTOCOL_PROVISIONAL_NOTE =
  'Protocolo provisional: umbrales y selección de molécula pendientes de validación por el referente clínico. ' +
  'Es soporte a la decisión, no una indicación.';

// ── Entradas ────────────────────────────────────────────────────────────────

/** Datos del paciente que alimentan la evaluación. Todo opcional salvo flags. */
export interface GLP1Inputs {
  ageYears?: number;
  sex?: 'male' | 'female';
  // Antropometría
  bmi?: number;
  waistCm?: number;
  // Glucemia / insulina
  hba1cPercent?: number;
  fastingGlucoseMgDl?: number;
  fastingInsulinUUmL?: number;
  homaIr?: number;
  // Renal
  egfr?: number;
  uacrMgG?: number;
  // Cardiovascular
  sbp?: number;
  ckmStage?: CKMStage;
  ascvd10y?: number;
  // Antecedentes (Condition activas)
  hasT2D?: boolean;
  hasType1Diabetes?: boolean;
  hasASCVD?: boolean;
  hasHeartFailure?: boolean;
  hasMTCorMEN2?: boolean;
  hasPancreatitisHistory?: boolean;
  hasSevereGastroparesis?: boolean;
  hasGallbladderDisease?: boolean;
  hasRetinopathy?: boolean;
  isPregnantOrPlanning?: boolean;
  // Medicación activa
  onInsulin?: boolean;
  onSulfonylurea?: boolean;
  onGLP1?: boolean;
}

// ── Fenotipo metabólico ─────────────────────────────────────────────────────

export type MetabolicPhenotype =
  | 'dm2'
  | 'prediabetes'
  | 'resistencia-insulinica'
  | 'obesidad-sin-disglucemia'
  | 'sin-alteracion'
  | 'datos-insuficientes';

export const PHENOTYPE_LABELS: Record<MetabolicPhenotype, string> = {
  dm2: 'Diabetes tipo 2',
  prediabetes: 'Prediabetes',
  'resistencia-insulinica': 'Resistencia insulínica / hiperinsulinemia',
  'obesidad-sin-disglucemia': 'Exceso de peso sin disglucemia',
  'sin-alteracion': 'Sin alteración metabólica detectada',
  'datos-insuficientes': 'Datos insuficientes',
};

// Umbrales. Cada uno con su fuente; los marcados PROVISIONAL no tienen consenso
// firme y son los primeros que hay que revisar con el referente clínico.
export const UMBRALES = {
  /** HbA1c ≥6.5 % = diabetes (ADA, Standards of Care). */
  hba1cDiabetes: 6.5,
  /** HbA1c 5.7–6.4 % = prediabetes (ADA). */
  hba1cPrediabetesMin: 5.7,
  /** Glucemia en ayunas ≥126 mg/dL = diabetes (ADA). */
  glucosaDiabetes: 126,
  /** Glucemia en ayunas 100–125 mg/dL = glucemia alterada en ayunas (ADA). */
  glucosaPrediabetesMin: 100,
  /** HOMA-IR > 2.5 sugiere resistencia insulínica. PROVISIONAL: el punto de
   *  corte varía entre 2.0 y 3.0 según la población y el ensayo de insulina. */
  homaIr: 2.5,
  /** Insulina basal > 12 µU/mL sugiere hiperinsulinemia. PROVISIONAL. */
  insulinaBasal: 12,
  /** IMC ≥30 = obesidad (OMS). Indicación de farmacoterapia por sí sola. */
  imcObesidad: 30,
  /** IMC ≥27 habilita farmacoterapia SI hay comorbilidad asociada. */
  imcSobrepesoConComorbilidad: 27,
  /** Cintura de riesgo, criterio IDF para Centro/Sudamérica: 90 cm (H) / 80 cm (M).
   *  Es MÁS BAJO que el de ATP III (102/88), usado en población europea/EEUU. */
  cinturaHombre: 90,
  cinturaMujer: 80,
  /** eGFR <60 mL/min/1.73m² = enfermedad renal crónica (KDIGO). */
  egfrErc: 60,
  /** UACR ≥30 mg/g = albuminuria (KDIGO). */
  uacrAlbuminuria: 30,
  /** ASCVD 10 años ≥20 % = riesgo alto (ACC/AHA). */
  ascvdAlto: 20,
} as const;

/** Clasifica el fenotipo metabólico. El orden importa: gana el más severo. */
export function metabolicPhenotype(i: GLP1Inputs): MetabolicPhenotype {
  const { hba1cPercent: a1c, fastingGlucoseMgDl: glu, homaIr, fastingInsulinUUmL: ins, bmi } = i;

  if (
    i.hasT2D ||
    (a1c !== undefined && a1c >= UMBRALES.hba1cDiabetes) ||
    (glu !== undefined && glu >= UMBRALES.glucosaDiabetes)
  ) {
    return 'dm2';
  }
  if (
    (a1c !== undefined && a1c >= UMBRALES.hba1cPrediabetesMin) ||
    (glu !== undefined && glu >= UMBRALES.glucosaPrediabetesMin)
  ) {
    return 'prediabetes';
  }
  // Resistencia insulínica con glucemia todavía normal: el caso más frecuente
  // en la población de BioWellness y el que se pierde si solo se mira glucemia.
  if ((homaIr !== undefined && homaIr > UMBRALES.homaIr) || (ins !== undefined && ins > UMBRALES.insulinaBasal)) {
    return 'resistencia-insulinica';
  }
  if (bmi !== undefined && bmi >= UMBRALES.imcSobrepesoConComorbilidad) {
    return 'obesidad-sin-disglucemia';
  }
  // Sin nada que evaluar: no se puede afirmar "sin alteración".
  if (a1c === undefined && glu === undefined && homaIr === undefined && ins === undefined && bmi === undefined) {
    return 'datos-insuficientes';
  }
  return 'sin-alteracion';
}

// ── Contraindicaciones y precauciones ───────────────────────────────────────

export interface Flag {
  /** Texto para el médico. */
  text: string;
  /** Fuente / fundamento. */
  source?: string;
}

/**
 * Contraindicaciones ABSOLUTAS: bloquean la candidatura, no la matizan.
 * Si alguna aplica, el resultado es 'no-candidato' sin importar el resto.
 */
export function blockers(i: GLP1Inputs): Flag[] {
  const out: Flag[] = [];
  if (i.hasMTCorMEN2) {
    out.push({
      text: 'Antecedente personal o familiar de carcinoma medular de tiroides o NEM2.',
      source: 'Contraindicación de ficha técnica (semaglutida, tirzepatida, liraglutida).',
    });
  }
  if (i.isPregnantOrPlanning) {
    out.push({
      text: 'Embarazo, lactancia o búsqueda de embarazo. Requiere suspensión previa a la concepción.',
      source: 'Contraindicación de ficha técnica.',
    });
  }
  if (i.hasType1Diabetes) {
    out.push({
      text: 'Diabetes tipo 1: no indicado para el control glucémico.',
      source: 'Fuera de indicación aprobada.',
    });
  }
  return out;
}

/** Precauciones y ajustes: no bloquean, pero el médico tiene que verlas. */
export function cautions(i: GLP1Inputs): Flag[] {
  const out: Flag[] = [];
  if (i.hasPancreatitisHistory) {
    out.push({ text: 'Antecedente de pancreatitis: evaluar riesgo-beneficio y vigilar dolor abdominal.' });
  }
  if (i.hasSevereGastroparesis) {
    out.push({
      text: 'Gastroparesia o enfermedad gastrointestinal severa: el efecto sobre el vaciamiento gástrico puede agravarla.',
    });
  }
  if (i.hasGallbladderDisease) {
    out.push({ text: 'Enfermedad vesicular: el descenso rápido de peso aumenta el riesgo de colelitiasis.' });
  }
  if (i.onInsulin || i.onSulfonylurea) {
    out.push({
      text: `En tratamiento con ${[i.onInsulin && 'insulina', i.onSulfonylurea && 'sulfonilurea'].filter(Boolean).join(' y ')}: reducir dosis al iniciar para evitar hipoglucemia.`,
      source: 'Recomendación estándar de ficha técnica.',
    });
  }
  if (i.hasRetinopathy) {
    out.push({
      text: 'Retinopatía diabética: la mejoría glucémica rápida puede empeorarla transitoriamente. Control oftalmológico.',
      source: 'Señal observada en SUSTAIN-6.',
    });
  }
  if (i.egfr !== undefined && i.egfr < 30) {
    out.push({
      text: 'eGFR <30: vigilar deshidratación por efectos gastrointestinales (riesgo de injuria renal aguda).',
    });
  }
  // Sarcopenia: central en una población 40+ orientada a longevidad.
  if ((i.ageYears ?? 0) >= 60) {
    out.push({
      text: 'Edad ≥60: priorizar preservación de masa magra — objetivo proteico y entrenamiento de fuerza desde el inicio.',
      source: 'Pérdida de masa magra asociada al descenso de peso rápido.',
    });
  }
  if (i.onGLP1) {
    out.push({ text: 'Ya recibe un agonista GLP-1: esta evaluación es de seguimiento, no de inicio.' });
  }
  return out;
}

// ── Criterios de candidatura ────────────────────────────────────────────────

export type Candidacy = 'candidato' | 'posible' | 'no-candidato' | 'datos-insuficientes';

export const CANDIDACY_LABELS: Record<Candidacy, { label: string; color: string }> = {
  candidato: { label: 'Cumple criterios', color: 'teal' },
  posible: { label: 'A evaluar', color: 'yellow' },
  'no-candidato': { label: 'No cumple criterios', color: 'gray' },
  'datos-insuficientes': { label: 'Faltan datos', color: 'gray' },
};

/** Motivos que sostienen la candidatura, cada uno con su criterio. */
export function rationale(i: GLP1Inputs, phenotype: MetabolicPhenotype): Flag[] {
  const out: Flag[] = [];
  const comorbilidad =
    phenotype === 'dm2' ||
    phenotype === 'prediabetes' ||
    phenotype === 'resistencia-insulinica' ||
    i.hasASCVD === true ||
    (i.sbp !== undefined && i.sbp >= 130) ||
    (i.egfr !== undefined && i.egfr < UMBRALES.egfrErc);

  if (i.bmi !== undefined && i.bmi >= UMBRALES.imcObesidad) {
    out.push({ text: `IMC ${i.bmi} ≥ 30 (obesidad).`, source: 'Indicación de farmacoterapia por criterio de IMC.' });
  } else if (i.bmi !== undefined && i.bmi >= UMBRALES.imcSobrepesoConComorbilidad && comorbilidad) {
    out.push({ text: `IMC ${i.bmi} ≥ 27 con comorbilidad metabólica o cardiovascular.` });
  }

  const cintura = i.sex === 'female' ? UMBRALES.cinturaMujer : UMBRALES.cinturaHombre;
  if (i.waistCm !== undefined && i.waistCm >= cintura) {
    out.push({
      text: `Cintura ${i.waistCm} cm ≥ ${cintura} cm (adiposidad abdominal).`,
      source: 'Criterio IDF para Centro y Sudamérica.',
    });
  }

  if (phenotype === 'dm2') {
    out.push({ text: 'Diabetes tipo 2.' });
  }
  if (phenotype === 'prediabetes') {
    out.push({ text: 'Prediabetes (HbA1c 5,7–6,4 % o glucemia 100–125 mg/dL).', source: 'ADA.' });
  }
  if (phenotype === 'resistencia-insulinica') {
    out.push({
      text: `Resistencia insulínica${i.homaIr !== undefined ? ` (HOMA-IR ${i.homaIr})` : ''} con glucemia aún normal.`,
      source: 'Umbral provisional.',
    });
  }
  if (i.hasASCVD) {
    out.push({
      text: 'Enfermedad cardiovascular establecida.',
      source: 'SELECT: reducción de eventos CV en obesidad sin diabetes.',
    });
  }
  if (i.ascvd10y !== undefined && i.ascvd10y >= UMBRALES.ascvdAlto) {
    out.push({ text: `Riesgo ASCVD 10 años ${i.ascvd10y} % (alto).`, source: 'PREVENT / ACC-AHA.' });
  }
  if (
    (i.egfr !== undefined && i.egfr < UMBRALES.egfrErc) ||
    (i.uacrMgG !== undefined && i.uacrMgG >= UMBRALES.uacrAlbuminuria)
  ) {
    out.push({ text: 'Enfermedad renal crónica o albuminuria.', source: 'FLOW: reducción de eventos renales.' });
  }
  if (i.ckmStage !== undefined && i.ckmStage >= 2) {
    out.push({ text: `Estadío CKM ${i.ckmStage}.` });
  }
  return out;
}

/** Datos que faltan para poder evaluar bien (se listan para pedirlos). */
export function missingData(i: GLP1Inputs): string[] {
  const out: string[] = [];
  if (i.bmi === undefined) {
    out.push('IMC (peso y talla)');
  }
  if (i.waistCm === undefined) {
    out.push('Circunferencia de cintura');
  }
  if (i.hba1cPercent === undefined) {
    out.push('HbA1c');
  }
  if (i.fastingGlucoseMgDl === undefined) {
    out.push('Glucemia en ayunas');
  }
  if (i.homaIr === undefined && i.fastingInsulinUUmL === undefined) {
    out.push('Insulina basal / HOMA-IR');
  }
  if (i.egfr === undefined) {
    out.push('eGFR');
  }
  return out;
}

// ── Selección de molécula ───────────────────────────────────────────────────

export interface MoleculeSuggestion {
  /** Principio activo (DCI). Nunca marca comercial: la marca la elige el médico. */
  molecule: string;
  /** Por qué esta y no otra, con el ensayo que la respalda. */
  reason: string;
  evidence: string;
  /** Orden de prioridad: menor = más prioritaria para este perfil. */
  priority: number;
}

/**
 * Sugiere moléculas según el perfil, priorizando el desenlace que más le
 * importa a ESE paciente (cardiovascular, renal, glucémico o ponderal).
 * Es una sugerencia con evidencia citada; la decisión es del médico.
 */
export function suggestMolecules(i: GLP1Inputs, phenotype: MetabolicPhenotype): MoleculeSuggestion[] {
  const out: MoleculeSuggestion[] = [];
  const conERC = (i.egfr !== undefined && i.egfr < UMBRALES.egfrErc) || (i.uacrMgG ?? 0) >= UMBRALES.uacrAlbuminuria;
  const riesgoCV = i.hasASCVD === true || (i.ascvd10y ?? 0) >= UMBRALES.ascvdAlto;

  if (conERC) {
    out.push({
      molecule: 'Semaglutida',
      reason: 'Enfermedad renal crónica o albuminuria: es la que tiene evidencia de desenlaces renales.',
      evidence: 'FLOW (2024): reducción de eventos renales mayores en DM2 con ERC.',
      priority: 1,
    });
  }
  if (riesgoCV) {
    out.push({
      molecule: 'Semaglutida',
      reason: 'Riesgo cardiovascular alto o enfermedad establecida: evidencia de reducción de eventos CV.',
      evidence: 'SELECT (2023): −20 % MACE en sobrepeso/obesidad SIN diabetes.',
      priority: 1,
    });
  }
  if (i.hasHeartFailure) {
    out.push({
      molecule: 'Tirzepatida o semaglutida',
      reason: 'Insuficiencia cardíaca con fracción de eyección preservada asociada a obesidad.',
      evidence: 'SUMMIT (tirzepatida) y STEP-HFpEF (semaglutida).',
      priority: 2,
    });
  }
  if (phenotype === 'dm2') {
    out.push({
      molecule: 'Tirzepatida',
      reason: 'Diabetes tipo 2 con necesidad de mayor descenso de HbA1c.',
      evidence: 'Programa SURPASS: mayor reducción de HbA1c frente a semaglutida.',
      priority: 3,
    });
  }
  // Prioridad ponderal: aplica cuando el objetivo dominante es bajar de peso.
  if (i.bmi !== undefined && i.bmi >= UMBRALES.imcObesidad) {
    out.push({
      molecule: 'Tirzepatida',
      reason: 'Objetivo de descenso ponderal máximo.',
      evidence: 'SURMOUNT-1 (~21 % a 72 semanas); SURMOUNT-5: superior a semaglutida en peso.',
      priority: 3,
    });
  }

  // Perfil disglucémico SIN diabetes ni ECV: resistencia insulínica o
  // prediabetes con sobrepeso. Es el paciente más frecuente de BioWellness y
  // queda fuera de todas las reglas anteriores (no tiene ERC, ni evento CV, ni
  // DM2, ni IMC ≥30), así que necesita su propia regla o no se sugiere nada.
  if (phenotype === 'resistencia-insulinica' || phenotype === 'prediabetes') {
    out.push({
      molecule: 'Tirzepatida',
      reason: 'Resistencia insulínica o prediabetes con exceso de peso: mayor efecto metabólico y ponderal.',
      evidence: 'SURMOUNT-1: alta tasa de reversión de prediabetes y menor progresión a diabetes.',
      priority: 4,
    });
    out.push({
      molecule: 'Semaglutida',
      reason: 'Alternativa con amplia experiencia de uso en descenso ponderal y mejoría glucémica.',
      evidence: 'Programa STEP.',
      priority: 5,
    });
  }

  // Deduplicar por molécula conservando la razón de mayor prioridad.
  const porMolecula = new Map<string, MoleculeSuggestion>();
  for (const s of out.sort((a, b) => a.priority - b.priority)) {
    if (!porMolecula.has(s.molecule)) {
      porMolecula.set(s.molecule, s);
    }
  }
  return [...porMolecula.values()];
}

// ── Evaluación completa ─────────────────────────────────────────────────────

export interface GLP1Assessment {
  phenotype: MetabolicPhenotype;
  candidacy: Candidacy;
  blockers: Flag[];
  cautions: Flag[];
  rationale: Flag[];
  missingData: string[];
  molecules: MoleculeSuggestion[];
}

/**
 * Evalúa al paciente de punta a punta. Puro: no toca el servidor ni la UI.
 *
 * Criterio de candidatura:
 * - Cualquier contraindicación absoluta ⇒ 'no-candidato'.
 * - Sin datos antropométricos ni glucémicos ⇒ 'datos-insuficientes'.
 * - Con motivos y sin bloqueos ⇒ 'candidato'.
 * - Con motivos pero faltando datos clave ⇒ 'posible' (hay que completar).
 */
export function assessGLP1(i: GLP1Inputs): GLP1Assessment {
  const phenotype = metabolicPhenotype(i);
  const bloqueos = blockers(i);
  const precauciones = cautions(i);
  const motivos = rationale(i, phenotype);
  const faltantes = missingData(i);

  let candidacy: Candidacy;
  if (bloqueos.length > 0) {
    candidacy = 'no-candidato';
  } else if (phenotype === 'datos-insuficientes') {
    candidacy = 'datos-insuficientes';
  } else if (motivos.length === 0) {
    candidacy = 'no-candidato';
  } else if (faltantes.length > 0) {
    // Hay criterios, pero con lagunas: no afirmar de más.
    candidacy = 'posible';
  } else {
    candidacy = 'candidato';
  }

  return {
    phenotype,
    candidacy,
    blockers: bloqueos,
    cautions: precauciones,
    rationale: motivos,
    missingData: faltantes,
    // Sin candidatura no se sugiere molécula: evita insinuar un tratamiento
    // en alguien que no cumple criterios o tiene una contraindicación.
    molecules: candidacy === 'candidato' || candidacy === 'posible' ? suggestMolecules(i, phenotype) : [],
  };
}

// Crea/actualiza el ValueSet de diagnósticos (Problems) en la URL canónica que
// usa el diálogo "Add Problem" del PatientSummary
// (http://hl7.org/fhir/us/core/ValueSet/us-core-condition-code), para resolver
// "ValueSet ... not found" sin cargar el SNOMED/ICD-10 completo.
//
// Subset curado de diagnósticos cardiometabólicos en ICD-10-CM. Ventaja: el bot
// ckm-recalculate detecta ECV clínica / diabetes por ICD-10, así que cargar
// estos problemas alimenta el estadío CKM (ej. estadío 4 por ECV clínica).
//
// Cada código se valida contra la API pública de NLM Clinical Tables (keyless);
// los que no existan se saltean. Se publica también un CodeSystem fragmento de
// ICD-10-CM para que Medplum self-hosted pueda expandir/validar.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run upload-condition-valueset
import { MedplumClient } from '@medplum/core';
import type { ValueSet, ValueSetComposeIncludeConcept } from '@medplum/fhirtypes';
import { upsertCodeSystemFragment } from './lib/terminology';
import { upsertUnico } from './lib/upsert';

const VALUESET_URL = 'http://hl7.org/fhir/us/core/ValueSet/us-core-condition-code';
const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';
const CLINICAL_TABLES = 'https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search';

// Subset curado de diagnósticos CKM (display en español). Códigos ICD-10-CM.
const CONDITIONS: { code: string; display: string }[] = [
  // Hipertensión
  { code: 'I10', display: 'Hipertensión arterial esencial' },
  { code: 'I11.9', display: 'Cardiopatía hipertensiva sin insuficiencia cardíaca' },
  { code: 'I12.9', display: 'Nefropatía hipertensiva' },
  // Diabetes / metabólico
  { code: 'E11.9', display: 'Diabetes mellitus tipo 2 sin complicaciones' },
  { code: 'E11.65', display: 'Diabetes tipo 2 con hiperglucemia' },
  { code: 'E10.9', display: 'Diabetes mellitus tipo 1 sin complicaciones' },
  { code: 'R73.03', display: 'Prediabetes' },
  { code: 'E88.810', display: 'Síndrome metabólico' },
  // Dislipidemia
  { code: 'E78.5', display: 'Hiperlipidemia no especificada' },
  { code: 'E78.00', display: 'Hipercolesterolemia pura' },
  { code: 'E78.1', display: 'Hipertrigliceridemia pura' },
  { code: 'E78.2', display: 'Hiperlipidemia mixta' },
  // Obesidad
  { code: 'E66.9', display: 'Obesidad no especificada' },
  { code: 'E66.01', display: 'Obesidad mórbida por exceso de calorías' },
  // Enfermedad renal crónica
  { code: 'N18.30', display: 'Enfermedad renal crónica estadio 3 no especificado' },
  { code: 'N18.4', display: 'Enfermedad renal crónica estadio 4 (grave)' },
  { code: 'N18.5', display: 'Enfermedad renal crónica estadio 5' },
  { code: 'N18.6', display: 'Enfermedad renal terminal' },
  { code: 'N18.9', display: 'Enfermedad renal crónica no especificada' },
  // Enfermedad coronaria / cardiopatía isquémica
  { code: 'I25.10', display: 'Enfermedad coronaria aterosclerótica sin angina' },
  { code: 'I25.2', display: 'Infarto de miocardio antiguo' },
  { code: 'I20.9', display: 'Angina de pecho no especificada' },
  { code: 'I21.9', display: 'Infarto agudo de miocardio no especificado' },
  // Insuficiencia cardíaca
  { code: 'I50.9', display: 'Insuficiencia cardíaca no especificada' },
  { code: 'I50.22', display: 'Insuficiencia cardíaca sistólica (FE reducida) crónica' },
  { code: 'I50.32', display: 'Insuficiencia cardíaca diastólica (FE preservada) crónica' },
  // Arritmia
  { code: 'I48.91', display: 'Fibrilación auricular no especificada' },
  { code: 'I48.0', display: 'Fibrilación auricular paroxística' },
  // Cerebrovascular / vascular periférica
  { code: 'I63.9', display: 'Infarto cerebral (ACV isquémico) no especificado' },
  { code: 'Z86.73', display: 'Antecedente de ACV/AIT sin secuelas' },
  { code: 'I70.0', display: 'Aterosclerosis de aorta' },
  { code: 'I73.9', display: 'Enfermedad vascular periférica no especificada' },
  // Otros
  { code: 'Z95.5', display: 'Presencia de stent/angioplastia coronaria' },
  { code: 'Z95.1', display: 'Presencia de bypass coronario' },
  { code: 'F17.210', display: 'Dependencia de nicotina (cigarrillos)' },
  { code: 'Z72.0', display: 'Consumo de tabaco' },
  { code: 'R80.9', display: 'Proteinuria no especificada' },
];

/** Valida un código ICD-10-CM contra NLM Clinical Tables; devuelve el nombre oficial o undefined. */
async function validateIcd10(code: string): Promise<string | undefined> {
  const res = await fetch(`${CLINICAL_TABLES}?sf=code&terms=${encodeURIComponent(code)}`);
  if (!res.ok) {
    return undefined;
  }
  const data = (await res.json()) as [number, string[], unknown, [string, string][]];
  const match = (data[3] ?? []).find((x) => x[0] === code);
  return match?.[1];
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }

  console.log('Validando códigos ICD-10-CM contra NLM Clinical Tables...');
  const concepts: ValueSetComposeIncludeConcept[] = [];
  for (const cond of CONDITIONS) {
    const official = await validateIcd10(cond.code);
    if (official) {
      concepts.push({ code: cond.code, display: cond.display });
    } else {
      console.log(`  ! código ICD-10 inválido o no encontrado: ${cond.code} (${cond.display}), salteado`);
    }
  }
  console.log(`Validados ${concepts.length}/${CONDITIONS.length} diagnósticos.`);

  const valueSet: ValueSet = {
    resourceType: 'ValueSet',
    url: VALUESET_URL,
    name: 'CardiometabolicConditions',
    title: 'Diagnósticos cardiometabólicos (subset CKM)',
    status: 'active',
    description:
      'Subset curado de diagnósticos cardiometabólicos en ICD-10-CM en la URL canónica del diálogo de ' +
      'problemas. Los códigos alimentan el estadío CKM (ECV clínica, diabetes, ERC).',
    compose: { include: [{ system: ICD10_SYSTEM, concept: concepts }] },
  };

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  console.log(`Proyecto del client: ${medplum.getProject()?.id}`);

  // CodeSystem fragmento de ICD-10-CM (mergeando), para que el ValueSet expanda.
  const csCount = await upsertCodeSystemFragment(
    medplum,
    ICD10_SYSTEM,
    concepts.map((c) => ({ code: c.code as string, display: c.display })),
    { name: 'Icd10CmFragment', title: 'ICD-10-CM — fragmento (CKM)' }
  );
  console.log(`OK: CodeSystem ICD-10-CM (${csCount} conceptos)`);
  const result = await upsertUnico(medplum, valueSet, `url=${encodeURIComponent(VALUESET_URL)}`);
  console.log(`OK: ValueSet/${result.id} (${concepts.length} conceptos) en ${baseUrl}`);

  try {
    const expanded = await medplum.valueSetExpand({ url: VALUESET_URL, filter: 'diab', count: 10 });
    const hits = expanded.expansion?.contains ?? [];
    console.log(`\nTest $expand filter="diab": ${hits.length} resultado(s)`);
    hits.forEach((h) => console.log(`  ${h.code}  ${h.display}`));
    console.log(
      hits.length > 0
        ? '  ✓ El $expand funciona. Recargá el chart con Ctrl+Shift+R y probá "Add Problem".'
        : '  ⚠ Sin resultados; revisar config de terminología del server.'
    );
  } catch (err) {
    console.log(`\nTest $expand falló: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message ?? err);
  process.exit(1);
});

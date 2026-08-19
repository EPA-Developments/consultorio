// Crea/actualiza un ValueSet acotado de medicación cardiometabólica en la URL
// canónica que usa el diálogo de medicación del PatientSummary
// (http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1010.4), para
// resolver el error "ValueSet ... not found" sin necesidad de subir el RxNorm
// completo (~80k conceptos, que da 413 por tamaño).
//
// Los RXCUI se resuelven en runtime desde la API pública de RxNorm (RxNav, sin
// API key) a partir de nombres de ingrediente, para no hardcodear códigos.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run upload-med-valueset
import { MedplumClient } from '@medplum/core';
import type { ValueSet, ValueSetComposeIncludeConcept } from '@medplum/fhirtypes';
import { upsertCodeSystemFragment } from './lib/terminology';
import { upsertUnico } from './lib/upsert';

const VALUESET_URL = 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1010.4';
const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const RXNAV = 'https://rxnav.nlm.nih.gov/REST';

// Lista curada: nombre RxNorm (en inglés, para la API) + display en español.
const MEDS: { name: string; display: string }[] = [
  // Estatinas
  { name: 'atorvastatin', display: 'Atorvastatina' },
  { name: 'rosuvastatin', display: 'Rosuvastatina' },
  { name: 'simvastatin', display: 'Simvastatina' },
  { name: 'pravastatin', display: 'Pravastatina' },
  { name: 'pitavastatin', display: 'Pitavastatina' },
  // Otros hipolipemiantes
  { name: 'ezetimibe', display: 'Ezetimibe' },
  { name: 'fenofibrate', display: 'Fenofibrato' },
  { name: 'gemfibrozil', display: 'Gemfibrozil' },
  { name: 'evolocumab', display: 'Evolocumab' },
  { name: 'alirocumab', display: 'Alirocumab' },
  // IECA
  { name: 'enalapril', display: 'Enalapril' },
  { name: 'lisinopril', display: 'Lisinopril' },
  { name: 'ramipril', display: 'Ramipril' },
  { name: 'perindopril', display: 'Perindopril' },
  // ARA-II
  { name: 'losartan', display: 'Losartán' },
  { name: 'valsartan', display: 'Valsartán' },
  { name: 'telmisartan', display: 'Telmisartán' },
  { name: 'candesartan', display: 'Candesartán' },
  { name: 'olmesartan', display: 'Olmesartán' },
  { name: 'irbesartan', display: 'Irbesartán' },
  // Calcioantagonistas
  { name: 'amlodipine', display: 'Amlodipina' },
  { name: 'nifedipine', display: 'Nifedipina' },
  { name: 'diltiazem', display: 'Diltiazem' },
  { name: 'verapamil', display: 'Verapamilo' },
  { name: 'lercanidipine', display: 'Lercanidipina' },
  // Betabloqueantes
  { name: 'metoprolol', display: 'Metoprolol' },
  { name: 'atenolol', display: 'Atenolol' },
  { name: 'bisoprolol', display: 'Bisoprolol' },
  { name: 'carvedilol', display: 'Carvedilol' },
  { name: 'nebivolol', display: 'Nebivolol' },
  // Diuréticos
  { name: 'hydrochlorothiazide', display: 'Hidroclorotiazida' },
  { name: 'chlorthalidone', display: 'Clortalidona' },
  { name: 'indapamide', display: 'Indapamida' },
  { name: 'furosemide', display: 'Furosemida' },
  { name: 'spironolactone', display: 'Espironolactona' },
  { name: 'eplerenone', display: 'Eplerenona' },
  // Antidiabéticos
  { name: 'metformin', display: 'Metformina' },
  { name: 'glimepiride', display: 'Glimepirida' },
  { name: 'gliclazide', display: 'Gliclazida' },
  { name: 'empagliflozin', display: 'Empagliflozina' },
  { name: 'dapagliflozin', display: 'Dapagliflozina' },
  { name: 'canagliflozin', display: 'Canagliflozina' },
  { name: 'liraglutide', display: 'Liraglutida' },
  { name: 'semaglutide', display: 'Semaglutida' },
  { name: 'dulaglutide', display: 'Dulaglutida' },
  { name: 'sitagliptin', display: 'Sitagliptina' },
  { name: 'pioglitazone', display: 'Pioglitazona' },
  { name: 'insulin glargine', display: 'Insulina glargina' },
  { name: 'insulin lispro', display: 'Insulina lispro' },
  // Antiagregantes / anticoagulantes
  { name: 'aspirin', display: 'Aspirina (AAS)' },
  { name: 'clopidogrel', display: 'Clopidogrel' },
  { name: 'ticagrelor', display: 'Ticagrelor' },
  { name: 'prasugrel', display: 'Prasugrel' },
  { name: 'warfarin', display: 'Warfarina' },
  { name: 'apixaban', display: 'Apixabán' },
  { name: 'rivaroxaban', display: 'Rivaroxabán' },
  { name: 'dabigatran', display: 'Dabigatrán' },
  { name: 'edoxaban', display: 'Edoxabán' },
  // Otros cardiovasculares
  { name: 'ivabradine', display: 'Ivabradina' },
  { name: 'isosorbide mononitrate', display: 'Mononitrato de isosorbida' },
];

async function getTty(rxcui: string): Promise<string | undefined> {
  const res = await fetch(`${RXNAV}/rxcui/${rxcui}/property.json?propName=TTY`);
  if (!res.ok) {
    return undefined;
  }
  const data = (await res.json()) as { propConceptGroup?: { propConcept?: { propValue?: string }[] } };
  return data.propConceptGroup?.propConcept?.[0]?.propValue;
}

/**
 * Resuelve el RXCUI del INGREDIENTE (TTY=IN) desde RxNorm. Una búsqueda por
 * nombre puede devolver varios (ingrediente IN y "precise ingredient" PIN);
 * preferimos el IN para registrar el medicamento a nivel de principio activo.
 */
async function resolveRxcui(name: string): Promise<string | undefined> {
  let candidates: string[] = [];
  for (const search of [1, 2]) {
    const res = await fetch(`${RXNAV}/rxcui.json?name=${encodeURIComponent(name)}&search=${search}`);
    if (!res.ok) {
      continue;
    }
    const data = (await res.json()) as { idGroup?: { rxnormId?: string[] } };
    candidates = data.idGroup?.rxnormId ?? [];
    if (candidates.length > 0) {
      break;
    }
  }
  if (candidates.length <= 1) {
    return candidates[0];
  }
  const byTty: Record<string, string> = {};
  for (const c of candidates) {
    const tty = await getTty(c);
    if (tty && !byTty[tty]) {
      byTty[tty] = c;
    }
  }
  return byTty.IN ?? byTty.PIN ?? candidates[0];
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }

  console.log('Resolviendo RXCUI desde RxNorm (RxNav)...');
  const concepts: ValueSetComposeIncludeConcept[] = [];
  for (const med of MEDS) {
    const code = await resolveRxcui(med.name);
    if (code) {
      concepts.push({ code, display: med.display });
    } else {
      console.log(`  ! sin RXCUI para "${med.name}", salteado`);
    }
  }
  console.log(`Resueltos ${concepts.length}/${MEDS.length} medicamentos.`);

  const valueSet: ValueSet = {
    resourceType: 'ValueSet',
    url: VALUESET_URL,
    name: 'CardiometabolicMedications',
    title: 'Medicación cardiometabólica (subset CKM)',
    status: 'active',
    description:
      'Subset curado de medicación cardiometabólica (estatinas, antihipertensivos, antidiabéticos, ' +
      'antiagregantes/anticoagulantes) en la URL canónica del diálogo de medicación. RXCUI desde RxNorm.',
    compose: { include: [{ system: RXNORM_SYSTEM, concept: concepts }] },
  };

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  console.log(`Proyecto del client: ${medplum.getProject()?.id}`);

  // CodeSystem fragmento de RxNorm (mergeando), para que Medplum self-hosted
  // pueda expandir/validar los conceptos.
  const csCount = await upsertCodeSystemFragment(
    medplum,
    RXNORM_SYSTEM,
    concepts.map((c) => ({ code: c.code as string, display: c.display })),
    { name: 'RxNormFragment', title: 'RxNorm — fragmento (CKM)' }
  );
  console.log(`OK: CodeSystem RxNorm (${csCount} conceptos)`);
  const result = await upsertUnico(medplum, valueSet, `url=${encodeURIComponent(VALUESET_URL)}`);
  console.log(`OK: ValueSet/${result.id} (${concepts.length} conceptos) en ${baseUrl}`);

  // Prueba de $expand: confirma que el servidor expande/filtra (independiente de la UI).
  try {
    const expanded = await medplum.valueSetExpand({ url: VALUESET_URL, filter: 'ator', count: 10 });
    const hits = expanded.expansion?.contains ?? [];
    console.log(`\nTest $expand filter="ator": ${hits.length} resultado(s)`);
    hits.forEach((h) => console.log(`  ${h.code}  ${h.display}`));
    if (hits.length === 0) {
      console.log('  ⚠ El servidor no devolvió resultados; revisar config de terminología del server.');
    } else {
      console.log('  ✓ El $expand funciona. Recargá el chart con Ctrl+Shift+R y probá el diálogo.');
    }
  } catch (err) {
    console.log(`\nTest $expand falló: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message ?? err);
  process.exit(1);
});

// Importa ValueSets de VSAC (NLM) al servidor Medplum self-hosted.
//
// Los diálogos del PatientSummary de @medplum/react usan ValueSets de VSAC
// (medicación y alergias) que el servidor hosted de Medplum trae precargados,
// pero que por licencia de UMLS no se pueden redistribuir: cada instancia
// self-hosted debe importarlos con su propia API key (gratuita) de UMLS.
//
// Uso:
//   UMLS_API_KEY=xxx MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx \
//     npx tsx src/scripts/import-vsac-valuesets.ts [oid ...]
//
// Sin argumentos importa los dos ValueSets que usa el PatientSummary.
import { MedplumClient } from '@medplum/core';
import type { CodeSystemConcept, ValueSet, ValueSetComposeInclude } from '@medplum/fhirtypes';
import { upsertCodeSystemFragment } from './lib/terminology';
import { upsertUnico } from './lib/upsert';

const VSAC_FHIR_BASE = 'https://cts.nlm.nih.gov/fhir';
const PAGE_SIZE = 500;

const DEFAULT_OIDS = [
  // Medications, prescribable (RxNorm) — diálogo de medicación del PatientSummary
  '2.16.840.1.113762.1.4.1010.4',
  // Allergens — diálogo de alergias del PatientSummary
  '2.16.840.1.113762.1.4.1186.8',
];

interface ExpansionConcept {
  system?: string;
  code?: string;
  display?: string;
}

async function fetchVsacExpansion(
  oid: string,
  apiKey: string
): Promise<{ name?: string; title?: string; version?: string; concepts: ExpansionConcept[] }> {
  const authorization = 'Basic ' + Buffer.from('apikey:' + apiKey).toString('base64');
  const concepts: ExpansionConcept[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let name: string | undefined;
  let title: string | undefined;
  let version: string | undefined;

  while (offset < total) {
    const url = `${VSAC_FHIR_BASE}/ValueSet/${oid}/$expand?count=${PAGE_SIZE}&offset=${offset}`;
    const response = await fetch(url, { headers: { Authorization: authorization } });
    if (!response.ok) {
      throw new Error(`VSAC respondió HTTP ${response.status} para ${oid}: ${await response.text()}`);
    }
    const valueSet = (await response.json()) as ValueSet;
    name ??= valueSet.name;
    title ??= valueSet.title;
    version ??= valueSet.version;
    total = valueSet.expansion?.total ?? 0;
    const page = valueSet.expansion?.contains ?? [];
    if (page.length === 0) {
      break;
    }
    concepts.push(...page);
    offset += page.length;
    console.log(`  ${oid}: ${concepts.length}/${total} conceptos descargados`);
  }

  return { name, title, version, concepts };
}

function buildValueSet(oid: string, data: Awaited<ReturnType<typeof fetchVsacExpansion>>): ValueSet {
  // Agrupa los conceptos por sistema de codificación (RxNorm, SNOMED, etc.)
  const bySystem = new Map<string, ExpansionConcept[]>();
  for (const concept of data.concepts) {
    if (!concept.system || !concept.code) {
      continue;
    }
    const group = bySystem.get(concept.system) ?? [];
    group.push(concept);
    bySystem.set(concept.system, group);
  }

  const include: ValueSetComposeInclude[] = [...bySystem.entries()].map(([system, concepts]) => ({
    system,
    concept: concepts.map((c) => ({ code: c.code as string, display: c.display })),
  }));

  return {
    resourceType: 'ValueSet',
    url: `${VSAC_FHIR_BASE.replace('https://', 'http://')}/ValueSet/${oid}`,
    name: data.name ?? oid,
    title: data.title,
    version: data.version,
    status: 'active',
    compose: { include },
  };
}

/** Agrupa los conceptos descargados por sistema (para los CodeSystem fragmento). */
function conceptsBySystem(data: Awaited<ReturnType<typeof fetchVsacExpansion>>): Map<string, CodeSystemConcept[]> {
  const bySystem = new Map<string, Map<string, string | undefined>>();
  for (const c of data.concepts) {
    if (!c.system || !c.code) {
      continue;
    }
    const group = bySystem.get(c.system) ?? new Map<string, string | undefined>();
    if (!group.has(c.code)) {
      group.set(c.code, c.display);
    }
    bySystem.set(c.system, group);
  }
  const result = new Map<string, CodeSystemConcept[]>();
  for (const [system, codes] of bySystem) {
    result.set(
      system,
      [...codes.entries()].map(([code, display]) => ({ code, display }))
    );
  }
  return result;
}

async function main(): Promise<void> {
  const umlsApiKey = process.env.UMLS_API_KEY;
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

  if (!umlsApiKey || !clientId || !clientSecret) {
    throw new Error(
      'Faltan variables de entorno: UMLS_API_KEY (https://uts.nlm.nih.gov/uts/profile), ' +
        'MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET (ClientApplication del proyecto en ' +
        baseUrl +
        ')'
    );
  }

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);

  const oids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_OIDS;
  for (const oid of oids) {
    console.log(`Descargando ValueSet ${oid} desde VSAC...`);
    const data = await fetchVsacExpansion(oid, umlsApiKey);
    const valueSet = buildValueSet(oid, data);
    const sizeMb = (JSON.stringify(valueSet).length / 1024 / 1024).toFixed(1);
    console.log(`Subiendo ${valueSet.url} (${data.concepts.length} conceptos, ~${sizeMb} MB) a ${baseUrl}...`);
    try {
      // CodeSystem fragmento por sistema (mergeando), para que el ValueSet expanda.
      for (const [system, concepts] of conceptsBySystem(data)) {
        const n = await upsertCodeSystemFragment(medplum, system, concepts);
        console.log(`  CodeSystem ${system}: ${n} conceptos`);
      }
      const result = await upsertUnico(medplum, valueSet, `url=${encodeURIComponent(valueSet.url as string)}`);
      console.log(`  OK: ValueSet/${result.id}`);
      const expanded = await medplum.valueSetExpand({ url: valueSet.url as string, count: 5 });
      console.log(
        `  Test $expand: ${expanded.expansion?.contains?.length ?? 0} de ${data.concepts.length} (muestra de 5)`
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('413')) {
        throw new Error(
          `El servidor rechazó el ValueSet ${oid} por tamaño (~${sizeMb} MB). ` +
            'Subí el límite de body en los dos niveles y reintentá:\n' +
            '  - nginx: client_max_body_size 64m; (y sudo nginx -t && sudo systemctl reload nginx)\n' +
            '  - Medplum server: "maxJsonSize": "64mb" en medplum.config.json (o MEDPLUM_MAX_JSON_SIZE=64mb)'
        );
      }
      throw err;
    }
  }
  console.log('Importación completa.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

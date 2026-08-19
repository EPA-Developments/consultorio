// Fase 2 del plan docs/VADEMECUM-SNOMED.md: carga el vademécum del DNM en el
// servidor Medplum como CodeSystem (CodeSystem/$import) + ValueSet, para que
// el buscador de medicamentos consulte ValueSet/$expand con filtro — sin
// engordar el bundle del frontend y sirviendo a todos los tenants del
// servidor (Favaloro | Medplum Argentina).
//
// El recorte: miembros ACTIVOS de los refsets "en estado comercializado" del
// DNM, que definen el vademécum vivo según ANMAT (mantenido por el CNTS):
//   - 574461000221103  fármacos de uso clínico comerciales en estado
//                      comercializado (las MARCAS)
//   - 574471000221107  fármacos de uso clínico con unidad de presentación
//                      definida vinculados a comercializados (GENÉRICOS)
//   - 574481000221105  ídem sin unidad de presentación definida (GENÉRICOS)
// Los tres refsets son del módulo argentino: la actividad de cada concepto se
// verifica contra el archivo de conceptos de la extensión — sin el punto
// ciego de los conceptos internacionales que nos mordió con rosuvastatina.
//
// La regla de la casa sigue intacta: este script no trae ningún código
// adentro; todo sale del RF2 descargado con la licencia MLDS y va a NUESTRO
// servidor (contenido licenciado: infraestructura propia, nunca terceros).
//
// Uso:
//   npm run snomed-vademecum -- --rf2 /ruta/al/padre
//     -> reporte: cuántos conceptos por clase, con muestras (no toca el server)
//   MEDPLUM_CLIENT_ID=... MEDPLUM_CLIENT_SECRET=... \
//     npm run snomed-vademecum -- --rf2 <dir> --aplicar
//     -> crea/actualiza el CodeSystem, importa los conceptos en lotes y deja
//        el ValueSet del vademécum; termina con un $expand de humo (CRESTOR)
import { MedplumClient } from '@medplum/core';
import type { CodeSystem, Parameters, ValueSet } from '@medplum/fhirtypes';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { pathToFileURL } from 'url';
import { DIAGNOSTICOS_SYSTEM, DIAGNOSTICOS_VALUESET_URL, VADEMECUM_VALUESET_URL } from '../recetas/vademecum';
import { normalizar, parseDescripcion } from './snomed-subset';

/** typeId de la Fully Specified Name en RF2. */
const FSN_TYPE = '900000000000003001';

export const SNOMED_SYSTEM = 'http://snomed.info/sct';

/** Refsets del DNM que definen el vademécum comercializado. */
export const REFSET_MARCAS = '574461000221103';
export const REFSETS_GENERICOS = ['574471000221107', '574481000221105'];
/** Refset de diagnósticos vinculados al Programa SUMAR (Edición Argentina). */
export const REFSET_DIAGNOSTICOS = '371191000221103';

// ── Parte pura (testeable) ──────────────────────────────────────────────────

/** Una fila de refset simple RF2 (6 columnas tab-separadas). */
export interface MiembroRefset {
  active: boolean;
  refsetId: string;
  conceptId: string;
}

export function parseMiembroSimple(line: string): MiembroRefset | undefined {
  const cols = line.split('\t');
  if (cols.length < 6 || cols[0] === 'id') {
    return undefined;
  }
  return { active: cols[2] === '1', refsetId: cols[4], conceptId: cols[5] };
}

/** El display del concepto: su FSN sin la etiqueta semántica final. */
export function displaySinTag(fsn: string): string {
  return fsn.replace(/\s*\([^()]+\)\s*$/, '').trim();
}

export type ClaseVademecum = 'marca' | 'generico' | 'diagnostico';

/** A qué clase del recorte pertenece un refset. */
export function claseDeRefset(refsetId: string): ClaseVademecum | undefined {
  if (refsetId === REFSET_MARCAS) {
    return 'marca';
  }
  if (refsetId === REFSET_DIAGNOSTICOS) {
    return 'diagnostico';
  }
  return REFSETS_GENERICOS.includes(refsetId) ? 'generico' : undefined;
}

/** Lotes para el $import: payloads acotados, importación reanudable. */
export function enLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano));
  }
  return lotes;
}

// ── Lectura de la release ───────────────────────────────────────────────────

function archivos(rf2Dir: string, patron: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (patron.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(rf2Dir);
  return out;
}

async function porLinea(file: string, fn: (line: string) => void): Promise<void> {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    fn(line);
  }
}

interface ConceptoVademecum {
  code: string;
  display: string;
  clase: ClaseVademecum;
}

async function extraer(rf2Dir: string): Promise<ConceptoVademecum[]> {
  // 1) Miembros activos de los refsets del recorte. Los paquetes traen los
  // miembros repetidos (archivo por-refset + combinado): Set dedupe.
  const porClase = new Map<string, ClaseVademecum>();
  for (const file of archivos(rf2Dir, /^der2_Refset_Simple.*Snapshot.*\.txt$/)) {
    await porLinea(file, (line) => {
      const m = parseMiembroSimple(line);
      if (!m?.active) {
        return;
      }
      const clase = claseDeRefset(m.refsetId);
      if (clase) {
        porClase.set(m.conceptId, clase);
      }
    });
  }
  console.log(`Miembros de refsets comercializados: ${porClase.size} conceptos`);

  // 2) Conceptos inactivados: afuera (los refsets del DNM son del módulo
  // argentino, así que el archivo de conceptos de la extensión alcanza).
  for (const file of archivos(rf2Dir, /^sct2_Concept_.*Snapshot.*\.txt$/)) {
    await porLinea(file, (line) => {
      const cols = line.split('\t');
      if (cols[0] !== 'id' && cols[2] !== '1' && porClase.has(cols[0])) {
        porClase.delete(cols[0]);
      }
    });
  }

  // 3) El FSN activo de cada miembro → display sin etiqueta.
  const conceptos = new Map<string, ConceptoVademecum>();
  for (const file of archivos(rf2Dir, /^sct2_Description_.*Snapshot.*\.txt$/)) {
    await porLinea(file, (line) => {
      const d = parseDescripcion(line);
      if (!d?.active || d.typeId !== FSN_TYPE) {
        return;
      }
      const clase = porClase.get(d.conceptId);
      if (clase && !conceptos.has(d.conceptId)) {
        conceptos.set(d.conceptId, { code: d.conceptId, display: displaySinTag(d.term), clase });
      }
    });
  }
  return [...conceptos.values()];
}

// ── Importación al servidor ─────────────────────────────────────────────────

const LOTE = 500;

function importParameters(system: string, conceptos: ConceptoVademecum[]): Parameters {
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'system', valueUri: system },
      ...conceptos.map((c) => ({
        name: 'concept',
        valueCoding: { system, code: c.code, display: c.display },
      })),
    ],
  };
}

async function conectar(): Promise<MedplumClient> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET para --aplicar');
  }
  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  console.log(`Conectado a ${baseUrl}`);
  return medplum;
}

async function asegurarCodeSystem(
  medplum: MedplumClient,
  deseado: Omit<CodeSystem, 'resourceType'>
): Promise<CodeSystem> {
  // content=not-present: los conceptos viven en la tabla de términos del
  // servidor, no en el recurso.
  const existente = await medplum.searchOne('CodeSystem', { url: deseado.url as string });
  const cs = existente
    ? await medplum.updateResource<CodeSystem>({
        ...existente,
        ...deseado,
        resourceType: 'CodeSystem',
        id: existente.id,
      })
    : await medplum.createResource<CodeSystem>({ ...deseado, resourceType: 'CodeSystem' });
  console.log(`CodeSystem ${existente ? 'actualizado' : 'creado'}: ${deseado.url} → ${cs.id}`);
  return cs;
}

async function asegurarValueSet(medplum: MedplumClient, deseado: Omit<ValueSet, 'resourceType'>): Promise<ValueSet> {
  const existente = await medplum.searchOne('ValueSet', { url: deseado.url as string });
  const vs = existente
    ? await medplum.updateResource<ValueSet>({ ...existente, ...deseado, resourceType: 'ValueSet', id: existente.id })
    : await medplum.createResource<ValueSet>({ ...deseado, resourceType: 'ValueSet' });
  console.log(`ValueSet listo: ${deseado.url} → ${vs.id}`);
  return vs;
}

async function importarConceptos(
  medplum: MedplumClient,
  system: string,
  conceptos: ConceptoVademecum[]
): Promise<void> {
  const lotes = enLotes(conceptos, LOTE);
  let importados = 0;
  for (const [i, lote] of lotes.entries()) {
    await medplum.post(medplum.fhirUrl('CodeSystem', '$import'), importParameters(system, lote));
    importados += lote.length;
    if ((i + 1) % 10 === 0 || i === lotes.length - 1) {
      console.log(`  ${importados}/${conceptos.length} conceptos importados`);
    }
  }
}

async function humo(medplum: MedplumClient, url: string, filter: string): Promise<void> {
  const expansion = await medplum.valueSetExpand({ url, filter, count: 5 });
  const hits = expansion.expansion?.contains ?? [];
  console.log(`\n$expand ${url.split('/').pop()} filter=${filter} → ${hits.length} resultado(s):`);
  for (const h of hits) {
    console.log(`  · ${h.code}  ${h.display}`);
  }
  if (hits.length === 0) {
    console.log('  ⚠ sin resultados: revisar que el proyecto del client sea el mismo que usa el Dashboard.');
  }
}

async function aplicar(conceptos: ConceptoVademecum[], version: string): Promise<void> {
  const medplum = await conectar();
  const medicamentos = conceptos.filter((c) => c.clase !== 'diagnostico');
  const diagnosticos = conceptos.filter((c) => c.clase === 'diagnostico');

  // 1) Vademécum de medicamentos, bajo el sistema SNOMED real.
  await asegurarCodeSystem(medplum, {
    url: SNOMED_SYSTEM,
    name: 'SNOMEDCT_AR_DNM',
    title: 'SNOMED CT Edición Argentina — vademécum DNM (comercializados)',
    status: 'active',
    content: 'not-present',
    version,
  });
  await importarConceptos(medplum, SNOMED_SYSTEM, medicamentos);
  await asegurarValueSet(medplum, {
    url: VADEMECUM_VALUESET_URL,
    name: 'VademecumDNM',
    title: 'Vademécum DNM (ANMAT, en estado comercializado)',
    status: 'active',
    version,
    compose: { include: [{ system: SNOMED_SYSTEM }] },
  });

  // 2) Diagnósticos (refset SUMAR), en su índice de búsqueda propio para no
  // mezclarse con el buscador de medicamentos. El coding que viaja en la
  // receta sigue siendo http://snomed.info/sct.
  await asegurarCodeSystem(medplum, {
    url: DIAGNOSTICOS_SYSTEM,
    name: 'DiagnosticosSnomedAR',
    title: 'Diagnósticos SNOMED Edición Argentina (refset SUMAR) — índice de búsqueda',
    status: 'active',
    content: 'not-present',
    version,
  });
  await importarConceptos(medplum, DIAGNOSTICOS_SYSTEM, diagnosticos);
  await asegurarValueSet(medplum, {
    url: DIAGNOSTICOS_VALUESET_URL,
    name: 'DiagnosticosSnomedAR',
    title: 'Diagnósticos SNOMED Edición Argentina (refset SUMAR)',
    status: 'active',
    version,
    compose: { include: [{ system: DIAGNOSTICOS_SYSTEM }] },
  });

  // Pruebas de humo: una por dominio.
  await humo(medplum, VADEMECUM_VALUESET_URL, 'CRESTOR');
  await humo(medplum, DIAGNOSTICOS_VALUESET_URL, 'diabetes');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rf2Idx = args.indexOf('--rf2');
  const rf2Dir = rf2Idx >= 0 ? args[rf2Idx + 1] : undefined;
  if (!rf2Dir || !fs.existsSync(rf2Dir)) {
    throw new Error('Falta --rf2 <directorio con las releases descomprimidas>.');
  }

  const conceptos = await extraer(rf2Dir);
  const marcas = conceptos.filter((c) => c.clase === 'marca');
  const genericos = conceptos.filter((c) => c.clase === 'generico');
  const diagnosticos = conceptos.filter((c) => c.clase === 'diagnostico');
  console.log(`\nA importar: ${conceptos.length} conceptos`);
  console.log(`  marcas comercializadas:   ${marcas.length}`);
  console.log(`  genéricos (droga+dosis):  ${genericos.length}`);
  console.log(`  diagnósticos (SUMAR):     ${diagnosticos.length}`);
  for (const ejemplo of ['crestor', 'aspirina', 'metformina']) {
    const hit = conceptos.find((c) => c.clase !== 'diagnostico' && normalizar(c.display).includes(ejemplo));
    console.log(`  muestra "${ejemplo}": ${hit ? `${hit.code} ${hit.display.slice(0, 70)}` : '(sin match)'}`);
  }
  for (const ejemplo of ['diabetes', 'hipertensi']) {
    const hit = diagnosticos.find((c) => normalizar(c.display).includes(ejemplo));
    console.log(`  muestra dx "${ejemplo}": ${hit ? `${hit.code} ${hit.display.slice(0, 70)}` : '(sin match)'}`);
  }

  if (!args.includes('--aplicar')) {
    console.log('\n(sin --aplicar no se toca el servidor)');
    return;
  }
  // La versión del CodeSystem es la fecha de la release argentina, tomada del
  // nombre del paquete descomprimido.
  const version = fs
    .readdirSync(rf2Dir, { recursive: true, withFileTypes: false })
    .map(String)
    .map((p) => /Argentina.*_(\d{8})T/.exec(p)?.[1])
    .find(Boolean);
  await aplicar(conceptos, version ?? 'desconocida');
}

// Ejecutar SOLO cuando se corre como script (misma guarda que snomed-subset).
const esEntrada = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (esEntrada) {
  main().catch((err) => {
    console.error('\n✗ Error:', err.message ?? err);
    process.exit(1);
  });
}

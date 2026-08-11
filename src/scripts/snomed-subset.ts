// Extrae los conceptId de SNOMED CT para los DCI del catálogo de recetas,
// DESDE la Edición Argentina descargada de MLDS. Fase 1 del plan
// docs/VADEMECUM-SNOMED.md.
//
// La regla dura del plan, materializada: los conceptId salen del RF2 oficial
// descargado con la licencia de afiliado — nunca de memoria, nunca de un
// buscador. Este script no trae ningún código adentro: lee los archivos de la
// release, propone candidatos CON su FSN para que un humano confirme, y solo
// escribe al catálogo cuando el candidato es único e inequívoco.
//
// Cómo distingue un medicamento de una sustancia SIN cargar la jerarquía
// entera: por la etiqueta semántica del FSN. "metformina (sustancia)" es el
// químico; "producto que contiene metformina (producto medicinal)" es lo que
// se prescribe a nivel DCI. La etiqueta viaja en el propio término, así que
// alcanza con las Descriptions — no hace falta el cierre transitivo de
// Relationships.
//
// Uso (con la release descomprimida, carpeta Snapshot incluida):
//   npm run snomed-subset -- --rf2 /ruta/a/SnomedCT_Argentina...
//     -> propone candidatos para los DCI del catálogo que no tienen snomedId
//   npm run snomed-subset -- --rf2 <dir> --aplicar
//     -> escribe en data/recetas/medicamentos.json SOLO los matches únicos
//   npm run snomed-subset -- --rf2 <dir> --verificar
//     -> re-chequea los snomedId ya cargados contra la release (guardia
//        contra typos y contra conceptos inactivados en releases nuevas)
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { pathToFileURL } from 'url';

const CATALOGO_FILE = 'data/recetas/medicamentos.json';

/** typeId de la Fully Specified Name en RF2. */
const FSN_TYPE = '900000000000003001';

// ── Parte pura (testeable) ──────────────────────────────────────────────────

/** Normaliza para comparar: minúsculas, sin diacríticos, espacios colapsados. */
export function normalizar(term: string): string {
  return term
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Una fila del archivo de Descriptions RF2 (columnas tab-separadas). */
export interface DescripcionRf2 {
  active: boolean;
  conceptId: string;
  typeId: string;
  term: string;
}

export function parseDescripcion(line: string): DescripcionRf2 | undefined {
  const cols = line.split('\t');
  if (cols.length < 9 || cols[0] === 'id') {
    return undefined;
  }
  return { active: cols[2] === '1', conceptId: cols[4], typeId: cols[6], term: cols[7] };
}

/** ¿Este término candidatea al concepto para una DCI dada? */
export function matcheaDci(term: string, dci: string): boolean {
  const t = normalizar(term);
  const d = normalizar(dci);
  if (t === d) {
    return true;
  }
  // "producto que contiene metformina (producto medicinal)" y variantes.
  for (const prefijo of [`producto que contiene ${d}`, `producto medicinal que contiene ${d}`]) {
    if (t.startsWith(prefijo)) {
      // Evitar que "metformina" matchee combinaciones ("...metformina y glibenclamida").
      const resto = t.slice(prefijo.length);
      if (resto === '' || resto.startsWith(' (') || resto.startsWith(' de ')) {
        return true;
      }
    }
  }
  return false;
}

/** Etiqueta semántica del FSN: lo que va entre los últimos paréntesis. */
export function etiquetaSemantica(fsn: string): string | undefined {
  const m = fsn.match(/\(([^()]+)\)\s*$/);
  return m?.[1]?.toLowerCase();
}

/**
 * Clasifica un candidato por su FSN. Solo 'producto-medicinal' es
 * recomendable para la receta a nivel DCI; la sustancia es el químico y el
 * producto clínico es forma+concentración (Fase 2).
 */
export type ClaseConcepto = 'producto-medicinal' | 'sustancia' | 'producto-clinico' | 'otro';

export function clasificar(fsn: string | undefined): ClaseConcepto {
  const cruda = fsn ? etiquetaSemantica(fsn) : undefined;
  if (!cruda) {
    return 'otro';
  }
  const tag = normalizar(cruda);
  if (tag === 'producto medicinal' || tag === 'medicinal product') {
    return 'producto-medicinal';
  }
  if (tag === 'sustancia' || tag === 'substance') {
    return 'sustancia';
  }
  // "fármaco de uso clínico" es la redacción de la extensión argentina (DNM)
  // para el nivel forma+concentración.
  if (tag.includes('producto medicinal cl') || tag.includes('clinical drug') || tag.includes('farmaco de uso clinico')) {
    return 'producto-clinico';
  }
  return 'otro';
}

export interface Candidato {
  conceptId: string;
  fsn?: string;
  clase: ClaseConcepto;
  terminoMatcheado: string;
}

/** Elige el candidato aplicable: exactamente UN producto medicinal activo. */
export function candidatoUnico(candidatos: Candidato[]): Candidato | undefined {
  const productos = candidatos.filter((c) => c.clase === 'producto-medicinal');
  return productos.length === 1 ? productos[0] : undefined;
}

// ── Lectura de la release ───────────────────────────────────────────────────

function archivosDescripcion(rf2Dir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Snapshot es el estado vigente; Full y Delta duplicarían o faltarían.
        walk(full);
      } else if (/^sct2_Description_.*Snapshot.*\.txt$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(rf2Dir);
  return out;
}

function archivosConcepto(rf2Dir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/^sct2_Concept_.*Snapshot.*\.txt$/.test(entry.name)) {
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

interface Catalogo {
  medicamentos: { dci: string; snomedId?: string; terminoSnomed?: string; presentaciones: string[] }[];
}

/**
 * Término con el que se busca en la edición: el alias terminoSnomed cuando la
 * edición nombra distinto que el formulario, la DCI en el caso normal.
 */
function terminoDe(m: Catalogo['medicamentos'][number]): string {
  return m.terminoSnomed ?? m.dci;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rf2Idx = args.indexOf('--rf2');
  const rf2Dir = rf2Idx >= 0 ? args[rf2Idx + 1] : undefined;
  if (!rf2Dir || !fs.existsSync(rf2Dir)) {
    throw new Error(
      'Falta --rf2 <directorio de la release descomprimida>.\n' +
        '  La Edición Argentina se descarga de https://mlds.ihtsdotools.org/ar\n' +
        '  (Mis Paquetes de la Versión), con la licencia de afiliado vigente.'
    );
  }
  const aplicar = args.includes('--aplicar');
  const verificar = args.includes('--verificar');

  const catalogo = JSON.parse(fs.readFileSync(CATALOGO_FILE, 'utf8')) as Catalogo;
  const objetivos = verificar
    ? catalogo.medicamentos.filter((m) => m.snomedId)
    : catalogo.medicamentos.filter((m) => !m.snomedId);
  if (objetivos.length === 0) {
    console.log(verificar ? 'No hay snomedId cargados para verificar.' : 'Todos los DCI ya tienen snomedId.');
    return;
  }

  const descFiles = archivosDescripcion(rf2Dir);
  if (descFiles.length === 0) {
    throw new Error(`No encontré sct2_Description_*Snapshot*.txt bajo ${rf2Dir}. ¿Está descomprimida la release?`);
  }
  // Los nombres de archivo cuentan QUÉ se está escaneando: si solo aparece la
  // extensión argentina, faltan las descripciones en español de los conceptos
  // internacionales (ver el aviso al final).
  console.log(`Release: ${descFiles.length} archivo(s) de descripciones`);
  for (const f of descFiles) {
    console.log(`  · ${path.relative(rf2Dir, f)}`);
  }
  console.log('');

  // Pasada 1: candidatos por término.
  const candidatosPorDci = new Map<string, Map<string, Candidato>>();
  for (const m of objetivos) {
    candidatosPorDci.set(m.dci, new Map());
  }
  for (const file of descFiles) {
    await porLinea(file, (line) => {
      const d = parseDescripcion(line);
      if (!d?.active) {
        return;
      }
      for (const m of objetivos) {
        if (matcheaDci(d.term, terminoDe(m))) {
          const mapa = candidatosPorDci.get(m.dci) as Map<string, Candidato>;
          if (!mapa.has(d.conceptId)) {
            mapa.set(d.conceptId, { conceptId: d.conceptId, clase: 'otro', terminoMatcheado: d.term });
          }
        }
      }
    });
  }

  // Pasada 2: FSN de los candidatos (la clase sale de la etiqueta semántica).
  const idsCandidatos = new Set<string>();
  for (const mapa of candidatosPorDci.values()) {
    for (const id of mapa.keys()) {
      idsCandidatos.add(id);
    }
  }
  for (const file of descFiles) {
    await porLinea(file, (line) => {
      const d = parseDescripcion(line);
      if (!d?.active || d.typeId !== FSN_TYPE || !idsCandidatos.has(d.conceptId)) {
        return;
      }
      for (const mapa of candidatosPorDci.values()) {
        const c = mapa.get(d.conceptId);
        if (c) {
          c.fsn = d.term;
          c.clase = clasificar(d.term);
        }
      }
    });
  }

  // Pasada 3: el concepto tiene que estar ACTIVO (una descripción activa puede
  // apuntar a un concepto inactivado).
  const inactivos = new Set<string>();
  for (const file of archivosConcepto(rf2Dir)) {
    await porLinea(file, (line) => {
      const cols = line.split('\t');
      if (cols[0] !== 'id' && idsCandidatos.has(cols[0]) && cols[2] !== '1') {
        inactivos.add(cols[0]);
      }
    });
  }

  // Reporte y aplicación.
  let aplicados = 0;
  let sinCandidatos = 0;
  for (const m of objetivos) {
    const candidatos = [...(candidatosPorDci.get(m.dci)?.values() ?? [])].filter((c) => !inactivos.has(c.conceptId));

    if (verificar) {
      const ok = candidatos.some((c) => c.conceptId === m.snomedId && c.clase === 'producto-medicinal');
      console.log(`${ok ? '✓' : '✗'} ${m.dci}: ${m.snomedId}${ok ? '' : ' NO se verifica contra la release'}`);
      continue;
    }

    console.log(`── ${m.dci}${m.terminoSnomed ? ` (busca: ${m.terminoSnomed})` : ''} ──`);
    if (candidatos.length === 0) {
      sinCandidatos++;
      console.log('  (sin candidatos: buscarlo a mano en el navegador oficial y cargarlo con su FSN a la vista)\n');
      continue;
    }
    for (const c of candidatos.sort((a, b) => a.clase.localeCompare(b.clase))) {
      const marca = c.clase === 'producto-medicinal' ? '→' : ' ';
      console.log(`  ${marca} ${c.conceptId}  [${c.clase}]  ${c.fsn ?? c.terminoMatcheado}`);
    }
    const unico = candidatoUnico(candidatos);
    if (unico && aplicar) {
      m.snomedId = unico.conceptId;
      aplicados++;
      console.log(`  ✓ aplicado: ${unico.conceptId}`);
    } else if (!unico) {
      console.log('  (más de un producto medicinal o ninguno: elegir a mano con el FSN a la vista)');
    }
    console.log('');
  }

  if (aplicar && aplicados > 0) {
    fs.writeFileSync(CATALOGO_FILE, JSON.stringify(catalogo, null, 2) + '\n');
    console.log(`${aplicados} snomedId escritos en ${CATALOGO_FILE}. Revisar el diff antes de commitear.`);
  }

  // La mayoría sin candidatos no es "SNOMED no los tiene": es la firma de estar
  // escaneando SOLO la extensión argentina. Los DCI internacionales (metformina,
  // atorvastatina, ...) reciben sus descripciones en español de la Edición
  // Internacional en Español de la que la extensión declara depender en su
  // release note — es una descarga separada en MLDS.
  if (!verificar && sinCandidatos > objetivos.length / 2) {
    console.log(
      'AVISO: la mayoría de los DCI salió sin candidatos. Si arriba se escaneó un solo\n' +
        'archivo de descripciones, el directorio probablemente contiene solo la EXTENSIÓN\n' +
        'argentina (conceptos creados en el país, como tirzepatida). Descargar también de\n' +
        'MLDS la Edición Internacional en Español de la que depende esta release (la fecha\n' +
        'exacta figura en su release note), descomprimir ambas bajo un mismo directorio\n' +
        'padre y volver a correr con --rf2 apuntando a ese padre.'
    );
  }
}

// Ejecutar SOLO cuando se corre como script (misma guarda que
// upload-biomarker-definitions): importar el módulo desde los tests de las
// funciones puras no debe disparar main() ni su process.exit.
const esEntrada = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (esEntrada) {
  main().catch((err) => {
    console.error('\n✗ Error:', err.message ?? err);
    process.exit(1);
  });
}

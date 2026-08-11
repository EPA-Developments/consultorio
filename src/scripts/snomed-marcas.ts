// Extrae del RF2 de la Extensión Argentina el mapeo MARCA COMERCIAL → DCI
// para los medicamentos del catálogo de recetas. Es la Fase 2 del plan
// docs/VADEMECUM-SNOMED.md aplicada al buscador del módulo Prescripciones:
// el médico tipea "Crestor" y el formulario le ofrece rosuvastatina — la
// marca busca, la DCI prescribe (Ley 25.649).
//
// De dónde sale: el DNM (Diccionario Nacional de Medicamentos) publica dentro
// de la extensión los "fármacos de uso clínico comerciales", cuyo FSN tiene
// forma parseable:
//   MARCA [PRINCIPIO ACTIVO (COMO SAL) DOSIS] FORMA (fármaco de uso clínico comercial)
//   ej.: COLMIBE [ATORVASTATIN (COMO ATORVASTATIN CALCICO) 40 MG + EZETIMIBA 10 MG] COMPRIMIDO
//
// La misma regla dura de snomed-subset: este script no trae ningún dato
// adentro — marcas y conceptId salen del RF2 descargado con la licencia MLDS.
// Las COMBINACIONES (composición con "+") se excluyen: no mapean a una DCI
// única y prescribir la combinación por error es un error clínico.
//
// Uso:
//   npm run snomed-marcas -- --rf2 /ruta/al/directorio/padre
//     -> reporta cuántas marcas encontró por DCI, con ejemplos
//   npm run snomed-marcas -- --rf2 <dir> --aplicar
//     -> escribe data/recetas/marcas.json (revisar el diff antes de commitear)
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { pathToFileURL } from 'url';
import { normalizar, parseDescripcion } from './snomed-subset';

const CATALOGO_FILE = 'data/recetas/medicamentos.json';
const MARCAS_FILE = 'data/recetas/marcas.json';

/** typeId de la Fully Specified Name en RF2. */
const FSN_TYPE = '900000000000003001';

// ── Parte pura (testeable) ──────────────────────────────────────────────────

export interface FsnComercial {
  marca: string;
  composicion: string;
  forma: string;
}

/** Parsea el FSN de un fármaco de uso clínico comercial del DNM. */
export function parseFsnComercial(fsn: string): FsnComercial | undefined {
  const m = fsn.match(/^(.*?)\s*\[(.*?)\]\s*(.*?)\s*\(([^()]+)\)\s*$/);
  if (!m) {
    return undefined;
  }
  if (normalizar(m[4]) !== 'farmaco de uso clinico comercial') {
    return undefined;
  }
  const marca = m[1].trim();
  const composicion = m[2].trim();
  if (!marca || !composicion) {
    return undefined;
  }
  const forma = m[3].trim();
  // Un segundo corchete en la "forma" delata una combinación escrita como
  // [COMPONENTE A] [COMPONENTE B]: afuera, no mapea a una DCI única.
  if (forma.includes('[')) {
    return undefined;
  }
  return { marca, composicion, forma };
}

/**
 * Sales y formas químicas habituales en la nomenclatura ANMAT/DNM cuando van
 * pegadas al principio activo ("METFORMINA CLORHIDRATO 500 MG"). La sal no
 * cambia la DCI que se prescribe.
 */
const SALES = new Set([
  'clorhidrato',
  'diclorhidrato',
  'sulfato',
  'fosfato',
  'acetato',
  'maleato',
  'besilato',
  'fumarato',
  'hemifumarato',
  'tartrato',
  'citrato',
  'calcica',
  'calcico',
  'sodica',
  'sodico',
  'potasica',
  'potasico',
  'magnesica',
  'magnesico',
  'anhidra',
  'anhidro',
  'monohidrato',
  'dihidrato',
  'micronizada',
  'micronizado',
]);

export interface MedicamentoDelCatalogo {
  dci: string;
  terminoSnomed?: string;
}

/**
 * DCI del catálogo a la que corresponde una composición del DNM, o undefined.
 * Combinaciones ("X + Y") quedan afuera. Las cláusulas de sal ("(COMO ...)")
 * se descartan y el principio activo es lo que precede a la dosis. ANMAT a
 * veces trunca la vocal final ("ATORVASTATIN"): se acepta esa variante.
 */
export function dciDeComposicion(composicion: string, meds: MedicamentoDelCatalogo[]): string | undefined {
  const limpia = normalizar(composicion.replace(/\([^)]*\)/g, ' '));
  if (limpia.includes('+') || / y /.test(limpia)) {
    return undefined;
  }
  // Regla definicional, independiente del separador que use el DNM: si la
  // composición trae DOS dosis, es una combinación. (El reporte real mostró
  // combinaciones "DUO" colándose con separadores distintos de "+".)
  const dosis = limpia.match(/\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ui|%)\b/g) ?? [];
  if (dosis.length > 1) {
    return undefined;
  }
  const principio = limpia.split(/\s+[\d,./]/)[0]?.trim();
  if (!principio) {
    return undefined;
  }
  const palabras = principio.split(' ');
  for (const m of meds) {
    for (const termino of [m.dci, m.terminoSnomed]) {
      if (!termino) {
        continue;
      }
      const t = normalizar(termino);
      const nPalabras = t.split(' ').length;
      if (palabras.length < nPalabras) {
        continue;
      }
      const cabeza = palabras.slice(0, nPalabras).join(' ');
      const resto = palabras.slice(nPalabras);
      // La cabeza debe ser la DCI (o su variante ANMAT sin la vocal final) y
      // lo que sobre, solo sales de la whitelist: "metformina clorhidrato"
      // es metformina; "metformina glibenclamida" NO.
      const cabezaOk = cabeza === t || `${cabeza}a` === t;
      if (cabezaOk && resto.every((w) => SALES.has(w))) {
        return m.dci;
      }
    }
  }
  return undefined;
}

export interface MarcaComercial {
  marca: string;
  dci: string;
  presentacion: string;
  conceptId: string;
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

interface Catalogo {
  medicamentos: { dci: string; terminoSnomed?: string }[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rf2Idx = args.indexOf('--rf2');
  const rf2Dir = rf2Idx >= 0 ? args[rf2Idx + 1] : undefined;
  if (!rf2Dir || !fs.existsSync(rf2Dir)) {
    throw new Error('Falta --rf2 <directorio con la Extensión Argentina descomprimida>.');
  }
  const aplicar = args.includes('--aplicar');

  const catalogo = JSON.parse(fs.readFileSync(CATALOGO_FILE, 'utf8')) as Catalogo;

  const descFiles = archivos(rf2Dir, /^sct2_Description_.*Snapshot.*\.txt$/);
  if (descFiles.length === 0) {
    throw new Error(`No encontré sct2_Description_*Snapshot*.txt bajo ${rf2Dir}.`);
  }

  // Pasada 1: FSN activos de fármacos de uso clínico comerciales que matchean
  // una DCI del catálogo. Un concepto = una marca+dosis+forma.
  const porConcepto = new Map<string, MarcaComercial>();
  for (const file of descFiles) {
    await porLinea(file, (line) => {
      const d = parseDescripcion(line);
      if (!d?.active || d.typeId !== FSN_TYPE) {
        return;
      }
      const comercial = parseFsnComercial(d.term);
      if (!comercial) {
        return;
      }
      const dci = dciDeComposicion(comercial.composicion, catalogo.medicamentos);
      if (dci && !porConcepto.has(d.conceptId)) {
        porConcepto.set(d.conceptId, {
          marca: comercial.marca,
          dci,
          presentacion: [comercial.composicion, comercial.forma].filter(Boolean).join(' — '),
          conceptId: d.conceptId,
        });
      }
    });
  }

  // Pasada 2: el concepto tiene que estar activo.
  for (const file of archivos(rf2Dir, /^sct2_Concept_.*Snapshot.*\.txt$/)) {
    await porLinea(file, (line) => {
      const cols = line.split('\t');
      if (cols[0] !== 'id' && porConcepto.has(cols[0]) && cols[2] !== '1') {
        porConcepto.delete(cols[0]);
      }
    });
  }

  const marcas = [...porConcepto.values()].sort(
    (a, b) => a.dci.localeCompare(b.dci) || a.marca.localeCompare(b.marca) || a.presentacion.localeCompare(b.presentacion)
  );

  // Reporte por DCI: cuántas marcas distintas, con muestras.
  for (const m of catalogo.medicamentos) {
    const deEsta = marcas.filter((x) => x.dci === m.dci);
    const nombres = [...new Set(deEsta.map((x) => x.marca))];
    console.log(`── ${m.dci}: ${deEsta.length} presentaciones comerciales, ${nombres.length} marcas ──`);
    for (const nombre of nombres.slice(0, 8)) {
      console.log(`   · ${nombre}`);
    }
    if (nombres.length > 8) {
      console.log(`   … y ${nombres.length - 8} marcas más`);
    }
  }
  console.log(`\nTotal: ${marcas.length} presentaciones comerciales de ${new Set(marcas.map((m) => m.marca)).size} marcas.`);

  if (aplicar) {
    const salida = {
      version: new Date().toISOString().slice(0, 10),
      fuente:
        'DNM (Diccionario Nacional de Medicamentos), FSN de fármacos de uso clínico comerciales de la Extensión Argentina de SNOMED CT, licencia MLDS de afiliado.',
      nota: 'La marca BUSCA, la DCI PRESCRIBE (Ley 25.649). Las combinaciones se excluyen a propósito: no mapean a una DCI única. Regenerar con: npm run snomed-marcas -- --rf2 <dir> --aplicar',
      marcas,
    };
    fs.writeFileSync(MARCAS_FILE, JSON.stringify(salida, null, 2) + '\n');
    console.log(`\nEscrito ${MARCAS_FILE}. Revisar el diff antes de commitear.`);
  } else {
    console.log('\n(sin --aplicar no se escribe nada)');
  }
}

// Ejecutar SOLO cuando se corre como script (misma guarda que snomed-subset).
const esEntrada = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (esEntrada) {
  main().catch((err) => {
    console.error('\n✗ Error:', err.message ?? err);
    process.exit(1);
  });
}

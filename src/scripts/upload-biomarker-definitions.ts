// Sube el panel de biomarcadores (ObservationDefinitions) a Medplum,
// como fuente de verdad FHIR de rangos, interpretaciones y paneles. El bundle es
// idempotente (PUT por id), así que correrlo varias veces actualiza sin duplicar.
//
// El bundle se manda EN LOTES: el servidor rechaza una transacción con más de 50
// operaciones de escritura ("Transaction contains more update operations than
// allowed"), y el catálogo pasó de 50 a 107 biomarcadores. Cada lote es su
// propia transacción —atómica—, así que ninguno puede quedar a medias.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run upload-biomarker-defs
import { MedplumClient } from '@medplum/core';
import type { Bundle, OperationOutcome } from '@medplum/fhirtypes';
import { pathToFileURL } from 'node:url';
import biomarkerBundle from '../../data/ckm/biomarker-definitions.json';

/**
 * Máximo de entradas por transacción. El tope del servidor es 50 operaciones de
 * update; si en algún momento vuelve a fallar, bajarlo.
 */
export const TAMANO_LOTE = 50;

function firstDiagnostic(outcome: OperationOutcome | undefined): string {
  return outcome?.issue?.[0]?.diagnostics ?? outcome?.issue?.[0]?.details?.text ?? '';
}

/** Parte un bundle transaction en varios de a lo sumo `tamano` entradas. */
export function partirEnLotes(bundle: Bundle, tamano = TAMANO_LOTE): Bundle[] {
  const entradas = bundle.entry ?? [];
  const lotes: Bundle[] = [];
  for (let i = 0; i < entradas.length; i += tamano) {
    lotes.push({
      resourceType: 'Bundle',
      type: 'transaction',
      entry: entradas.slice(i, i + tamano),
    });
  }
  return lotes;
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }

  const bundle = biomarkerBundle as unknown as Bundle;
  const total = bundle.entry?.length ?? 0;

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  console.log(`Subiendo ${total} ObservationDefinitions a ${baseUrl} (proyecto ${medplum.getProject()?.id})...`);

  const lotes = partirEnLotes(bundle);
  console.log(`  (en ${lotes.length} lote/s de hasta ${TAMANO_LOTE})`);

  let ok = 0;
  const fallidas: string[] = [];

  for (const [i, lote] of lotes.entries()) {
    const esperadas = lote.entry?.length ?? 0;
    let entries;
    try {
      const result = await medplum.executeBatch(lote);
      entries = result.entry ?? [];
    } catch (err) {
      // La transacción entera fue rechazada: ninguna de sus entradas se aplicó.
      const msg = (err as Error).message ?? String(err);
      console.log(`  lote ${i + 1}/${lotes.length}: ✗ rechazado (${esperadas} sin aplicar) — ${msg}`);
      fallidas.push(`lote ${i + 1}: ${msg}`);
      continue;
    }

    // El bundle contesta 200 aunque sus entradas fallen: hay que mirar el
    // response de CADA entrada o una carga a medias pasa por exitosa.
    const exitos = entries.filter((e) => e.response?.status?.startsWith('2'));
    const errores = entries.filter((e) => !e.response?.status?.startsWith('2'));
    ok += exitos.length;
    console.log(`  lote ${i + 1}/${lotes.length}: ${exitos.length}/${esperadas} OK`);
    for (const e of errores) {
      const detalle = `${e.response?.status} ${firstDiagnostic(e.response?.outcome)}`;
      console.log(`    ✗ ${detalle}`);
      fallidas.push(detalle);
    }
  }

  console.log(`\n${ok}/${total} biomarcadores subidos.`);
  if (fallidas.length > 0) {
    console.log(`✗ ${fallidas.length} fallaron.`);
    process.exit(1);
  }
}

// Ejecutar SOLO cuando se corre como script. Sin esta guarda, importar el
// módulo (por ejemplo desde los tests de partirEnLotes) dispararía el upload
// contra el servidor real.
const esEntrada = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (esEntrada) {
  main().catch((err) => {
    console.error('\n✗ Error:', err.message ?? err);
    process.exit(1);
  });
}

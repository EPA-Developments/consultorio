// Diagnóstico y reparación de los bots/subscriptions CKM en el servidor.
//
// El código del repo está correcto (criteria limpias, lógica de los bots OK).
// Los síntomas ("SDOH sin responder", labs que no impactan) suelen venir del
// ESTADO del servidor: un bot sin lambda desplegado, o una Subscription vieja
// que el redeploy no actualiza por el ifNoneExist (url=channel.endpoint).
//
// Subcomandos (no destructivos por defecto):
//   npm run ckm-bots-doctor              -> status (bots, subscriptions, audit)
//   npm run ckm-bots-doctor -- --check-code   -> compara el código DESPLEGADO de
//                                                 cada bot contra el bundle local
//   npm run ckm-bots-doctor -- --dedupe-subs  -> deja UNA Subscription por bot
//                                                 (borra las duplicadas)
//   npm run ckm-bots-doctor -- --reset-subs   -> borra las subs CKM (para
//                                                 recrearlas limpias con deploy)
//   npm run ckm-bots-doctor -- --reprocess <PatientId>  -> re-ejecuta los bots
//                                                 sobre los recursos existentes
//
// Requiere MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET (admin de proyecto).
import { MedplumClient } from '@medplum/core';
import type { Bundle, Observation, QuestionnaireResponse, Subscription } from '@medplum/fhirtypes';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { buscarBotPropio } from '../bot-lookup';
import { BOT_CKM_ALERTS, BOT_CKM_RECALCULATE, BOT_CKM_SDOH_RESPONSE, BOTS, BOTS_CKM } from '../bot-names';
import { CKM_STAGE_URL, HGRAPH_DATA_URL, SDOH_QUESTIONNAIRE_URL } from '../ckm/constants';
import { CKM_OBSERVATION_CODES } from '../ckm/observations';
import { descargarTexto } from './lib/descargar-binary';
import { describirErrorDeStorage, errorDeStorage } from './lib/storage-error';

const CKM_BOT_NAMES = BOTS_CKM;

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }
  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  const project = medplum.getProject();
  console.log(`Conectado a ${baseUrl}`);
  console.log(`Proyecto del client: ${project?.id}`);
  // Para que las Subscriptions disparen bots, el proyecto necesita la feature
  // "bots". Sin ella, $execute funciona pero el disparo automático no.
  const features = project?.features;
  console.log(`Features del proyecto: ${features ? JSON.stringify(features) : '(ninguna)'}`);
  if (!features?.includes('bots')) {
    console.log('  ⚠ Falta la feature "bots": las Subscriptions NO van a disparar bots en este proyecto.');
    console.log('    Un super-admin debe agregar "bots" a Project.features de ' + project?.id + '.');
  }
  console.log('  (los bots/subscriptions deben quedar en el MISMO proyecto que los pacientes de Control)\n');

  const resetIdx = process.argv.indexOf('--reprocess');
  if (process.argv.includes('--reset-subs')) {
    await resetSubscriptions(medplum);
    return;
  }
  if (process.argv.includes('--recreate-subs')) {
    await recreateSubscriptions(medplum);
    return;
  }
  if (process.argv.includes('--reprocess-all')) {
    await reprocessAll(medplum);
    return;
  }
  if (process.argv.includes('--dedupe-subs')) {
    await dedupeSubscriptions(medplum);
    return;
  }
  if (process.argv.includes('--check-code')) {
    await checkCode(medplum);
    return;
  }
  if (process.argv.includes('--fix-bot-membership')) {
    await fixBotMembership(medplum);
    return;
  }
  if (resetIdx !== -1) {
    const patientId = process.argv[resetIdx + 1];
    if (!patientId) {
      throw new Error('Uso: --reprocess <PatientId>');
    }
    await reprocess(medplum, patientId);
    return;
  }
  await status(medplum);
}

async function status(medplum: MedplumClient): Promise<void> {
  console.log('── BOTS ──');
  for (const name of CKM_BOT_NAMES) {
    const bot = await buscarBotPropio(medplum, name);
    if (!bot) {
      console.log(`  ✗ ${name}: NO existe`);
      continue;
    }
    const deployed = Boolean(bot.executableCode?.url);
    console.log(
      `  ${deployed ? '✓' : '✗'} ${name}: Bot/${bot.id} — runtime=${bot.runtimeVersion} — código ejecutable ${deployed ? 'presente' : 'AUSENTE (no desplegado)'}`
    );
    // Permisos del bot: corre con SU membership. Una AccessPolicy restrictiva
    // (o sin permiso de escritura sobre Patient) hace que dispare pero falle.
    const membership = await medplum.searchOne('ProjectMembership', `profile=Bot/${bot.id}`);
    if (!membership) {
      console.log('     membership: NO encontrada');
    } else {
      const policy = membership.accessPolicy?.display ?? membership.accessPolicy?.reference;
      console.log(
        `     membership ${membership.id}: admin=${membership.admin ?? false} accessPolicy=${policy ?? '(ninguna)'}`
      );
      if (policy) {
        console.log('     ⚠ Una AccessPolicy en el bot puede impedirle ESCRIBIR el Patient al dispararse.');
      }
    }
  }

  console.log('\n── SUBSCRIPTIONS ──');
  const subs = await medplum.searchResources('Subscription', { _count: '50' });
  for (const s of subs) {
    if (!CKM_BOT_NAMES.includes(s.reason ?? '')) {
      continue;
    }
    console.log(`  ${s.status === 'active' ? '✓' : '✗'} ${s.reason}: ${s.id} status=${s.status}`);
    console.log(`     endpoint=${s.channel?.endpoint}`);
    console.log(`     criteria=${JSON.stringify(s.criteria)}`);
  }
  console.log('\n  Esperadas (criteria limpia):');
  console.log(`   ${BOT_CKM_RECALCULATE}: Observation?code=${CKM_OBSERVATION_CODES.join(',')}`);
  console.log(`   ${BOT_CKM_SDOH_RESPONSE}: QuestionnaireResponse?questionnaire=${SDOH_QUESTIONNAIRE_URL}`);

  console.log('\n── AUDITEVENTS recientes de los bots (¿corrió?, ¿error?) ──');
  for (const name of CKM_BOT_NAMES) {
    const bot = await buscarBotPropio(medplum, name);
    if (!bot) {
      continue;
    }
    const audits = await medplum.searchResources('AuditEvent', {
      entity: `Bot/${bot.id}`,
      _count: '5',
      _sort: '-_lastUpdated',
    });
    console.log(`  ${name}: ${audits.length} AuditEvents`);
    for (const a of audits) {
      console.log(`     ${a.recorded} outcome=${a.outcome ?? '?'}`);
      if (a.outcomeDesc) {
        // Sin recortar: acá viene la salida del bot, que es todo el punto de
        // haberlo instrumentado. Recortarla dejaba el log cortado justo en la
        // parte que decide el diagnóstico.
        for (const linea of a.outcomeDesc.trim().split('\n')) {
          console.log(`       ${linea.trim()}`);
        }
      }
    }
  }
}

async function resetSubscriptions(medplum: MedplumClient): Promise<void> {
  console.log('Borrando Subscriptions CKM (se recrean limpias al re-desplegar)...');
  const subs = await medplum.searchResources('Subscription', { _count: '50' });
  for (const s of subs) {
    if (CKM_BOT_NAMES.includes(s.reason ?? '') && s.id) {
      await medplum.deleteResource('Subscription', s.id);
      console.log(`  ✓ borrada ${s.reason} (${s.id})`);
    }
  }
  console.log('\nAhora re-desplegá: npm run build:bots && npm run deploy-bots-server');
}

/**
 * Recrea las Subscriptions CKM creándolas de a una (no en una transacción
 * gigante, que el proyecto rechaza por "strict isolation ... too many entries").
 * Las crea con el client actual como autor, nativo del proyecto, que es lo que
 * permite que disparen. Borra las viejas primero.
 */
async function recreateSubscriptions(medplum: MedplumClient): Promise<void> {
  const existing = await medplum.searchResources('Subscription', { _count: '50' });
  for (const s of existing) {
    if (CKM_BOT_NAMES.includes(s.reason ?? '') && s.id) {
      await medplum.deleteResource('Subscription', s.id);
      console.log(`  borrada vieja ${s.reason} (${s.id})`);
    }
  }
  const specs = [
    { name: BOT_CKM_RECALCULATE, criteria: `Observation?code=${CKM_OBSERVATION_CODES.join(',')}` },
    { name: BOT_CKM_SDOH_RESPONSE, criteria: `QuestionnaireResponse?questionnaire=${SDOH_QUESTIONNAIRE_URL}` },
    // Mismos códigos que ckm-recalculate: dos Subscriptions sobre el mismo
    // criteria, una por bot, para que las alertas no puedan frenar el recálculo.
    { name: BOT_CKM_ALERTS, criteria: `Observation?code=${CKM_OBSERVATION_CODES.join(',')}` },
  ];
  for (const spec of specs) {
    const bot = await buscarBotPropio(medplum, spec.name);
    if (!bot) {
      console.log(`  ✗ bot ${spec.name} no encontrado, salteado`);
      continue;
    }
    const sub = await medplum.createResource({
      resourceType: 'Subscription',
      status: 'active',
      reason: spec.name,
      criteria: spec.criteria,
      channel: { type: 'rest-hook', endpoint: `Bot/${bot.id}` },
    });
    console.log(`  ✓ creada ${spec.name}: ${sub.id} -> Bot/${bot.id}`);
  }
  console.log('\nVerificá con: npm run verify-prevent (debe disparar el bot solo).');
}

/**
 * Resume lo que devolvió un $execute.
 *
 * Un bot que devuelve `undefined` salió por un early-return sin hacer nada, y
 * el $execute igual reporta éxito. Sin mirar la salida, ese caso es
 * indistinguible de uno que trabajó.
 */
export function resumirSalida(salida: unknown): string {
  if (salida === undefined || salida === null || salida === '') {
    return 'nada (el bot salió sin procesar: el recurso no le correspondía, o le faltaban datos)';
  }
  const r = salida as { resourceType?: string; id?: string };
  if (r.resourceType) {
    return `${r.resourceType}${r.id ? '/' + r.id : ''}`;
  }
  return JSON.stringify(salida).slice(0, 200);
}

async function reprocess(medplum: MedplumClient, patientId: string): Promise<void> {
  console.log(`Re-procesando recursos existentes de Patient/${patientId}...\n`);

  // Diagnóstico de proyecto: si el paciente está en otro proyecto que los bots,
  // las Subscriptions nunca disparan (y este client podría no verlo).
  const me = medplum.getProject()?.id;
  let patient;
  try {
    patient = await medplum.readResource('Patient', patientId);
  } catch (err) {
    console.log(`  ✗ No puedo leer Patient/${patientId}: ${(err as Error).message}`);
    console.log(`     Probablemente está en OTRO proyecto que el client/bots (proyecto del client: ${me}).`);
    return;
  }
  const patientProject = patient.meta?.project;
  console.log(`  Proyecto del client/bots: ${me}`);
  console.log(`  Proyecto del Patient:     ${patientProject}`);
  if (patientProject && patientProject !== me) {
    console.log(
      '  ⚠ El Patient está en OTRO proyecto que los bots. Por eso las Subscriptions\n' +
        '    no disparan: solo disparan dentro de su mismo proyecto. Hay que registrar\n' +
        '    a los pacientes de Control en el MISMO proyecto que los bots, o desplegar\n' +
        '    los bots/subscriptions también en el proyecto de Control.\n'
    );
  } else {
    console.log('  ✓ Mismo proyecto. El disparo debería funcionar; revisamos el $execute.\n');
  }

  // SDOH: última respuesta del cuestionario canónico
  const sdohBot = await buscarBotPropio(medplum, BOT_CKM_SDOH_RESPONSE);
  const responses = await medplum.searchResources('QuestionnaireResponse', {
    subject: `Patient/${patientId}`,
    questionnaire: SDOH_QUESTIONNAIRE_URL,
    _sort: '-_lastUpdated',
    _count: '1',
  });
  if (sdohBot && responses.length > 0) {
    const salida = await medplum.post(
      medplum.fhirUrl('Bot', sdohBot.id as string, '$execute'),
      responses[0] as QuestionnaireResponse
    );
    console.log(`  ✓ ${BOT_CKM_SDOH_RESPONSE} ejecutado sobre QuestionnaireResponse/${responses[0].id}`);
    console.log(`     devolvió: ${resumirSalida(salida)}`);
  } else {
    console.log(
      `  · SDOH: ${sdohBot ? 'sin QuestionnaireResponse del canónico para este paciente' : 'bot no encontrado'}`
    );
  }

  // CKM: última Observation CKM (dispara el recálculo de hGraph/estadío/PREVENT)
  const ckmBot = await buscarBotPropio(medplum, BOT_CKM_RECALCULATE);
  const obs = await medplum.searchResources('Observation', {
    subject: `Patient/${patientId}`,
    code: CKM_OBSERVATION_CODES.join(','),
    _sort: '-_lastUpdated',
    _count: '1',
  });
  const antes = patient.meta?.lastUpdated;
  if (ckmBot && obs.length > 0) {
    const salida = await medplum.post(medplum.fhirUrl('Bot', ckmBot.id as string, '$execute'), obs[0] as Observation);
    console.log(`  ✓ ${BOT_CKM_RECALCULATE} ejecutado sobre Observation/${obs[0].id}`);
    console.log(`     devolvió: ${resumirSalida(salida)}`);
  } else {
    console.log(`  · CKM: ${ckmBot ? 'sin Observation CKM para este paciente' : 'bot no encontrado'}`);
  }

  // El veredicto, acá y no "verificá el Patient a mano".
  //
  // OJO con leer solo lastUpdated: Medplum NO crea una versión nueva si el
  // contenido no cambió, así que un recálculo correcto que da el mismo
  // resultado deja lastUpdated igual. Eso no es "no escribió", es idempotencia.
  // Lo que prueba que el bot hizo su trabajo son las extensiones.
  const despues = await medplum.readResource('Patient', patientId);
  const tiene = (url: string): boolean => Boolean(despues.extension?.some((e) => e.url === url));
  const nuevaVersion = despues.meta?.lastUpdated !== antes;
  console.log('\n── ¿Escribió el bot? ──');
  console.log(`  Patient.meta.lastUpdated: ${antes} -> ${despues.meta?.lastUpdated}`);
  console.log(`  Extensiones: CKMStage=${tiene(CKM_STAGE_URL)} hGraphData=${tiene(HGRAPH_DATA_URL)}`);
  if (tiene(HGRAPH_DATA_URL)) {
    console.log('\n  ✓ El bot FUNCIONA cuando se lo ejecuta a mano.');
    if (!nuevaVersion) {
      console.log('    (lastUpdated no cambió porque el recálculo dio lo mismo que ya estaba:');
      console.log('     Medplum no versiona un update que no cambia nada. Es idempotencia, no un fallo.)');
    }
    console.log('    El código desplegado está bien. Si el circuito automático igual no');
    console.log('    persiste, lo que falla es el disparo por Subscription, no el bot.');
  } else {
    console.log('\n  ✗ El bot corrió y NO dejó las extensiones.');
    console.log('    Con el $execute directo no hay Subscription de por medio, así que el');
    console.log('    problema es el bot: su AccessPolicy no lo deja escribir el Patient (el bot');
    console.log('    se traga ese error), o salió por un early-return — mirá qué devolvió arriba.');
  }
}

/** Ejecuta los bots (vía $execute) sobre el último recurso de cada tipo del
 *  paciente. Devuelve cuántos $execute hizo. Silencioso salvo errores. */
async function runBotsForPatient(medplum: MedplumClient, patientId: string): Promise<number> {
  let ran = 0;
  const sdohBot = await buscarBotPropio(medplum, BOT_CKM_SDOH_RESPONSE);
  const responses = await medplum.searchResources('QuestionnaireResponse', {
    subject: `Patient/${patientId}`,
    questionnaire: SDOH_QUESTIONNAIRE_URL,
    _sort: '-_lastUpdated',
    _count: '1',
  });
  if (sdohBot && responses.length > 0) {
    await medplum.post(medplum.fhirUrl('Bot', sdohBot.id as string, '$execute'), responses[0] as QuestionnaireResponse);
    ran++;
  }
  const ckmBot = await buscarBotPropio(medplum, BOT_CKM_RECALCULATE);
  const obs = await medplum.searchResources('Observation', {
    subject: `Patient/${patientId}`,
    code: CKM_OBSERVATION_CODES.join(','),
    _sort: '-_lastUpdated',
    _count: '1',
  });
  if (ckmBot && obs.length > 0) {
    await medplum.post(medplum.fhirUrl('Bot', ckmBot.id as string, '$execute'), obs[0] as Observation);
    ran++;
  }
  return ran;
}

/**
 * Backfill masivo: reprocesa todos los pacientes vía $execute. Stopgap mientras
 * el disparo automático por Subscription no funciona (worker async del server).
 * Cron-eable (ej. cada 5 min) hasta que se arregle el worker.
 */
async function reprocessAll(medplum: MedplumClient): Promise<void> {
  const patients = await medplum.searchResources('Patient', { _count: '500' });
  console.log(`Reprocesando ${patients.length} pacientes vía $execute...`);
  let updated = 0;
  for (const p of patients) {
    if (!p.id) {
      continue;
    }
    try {
      const ran = await runBotsForPatient(medplum, p.id);
      if (ran > 0) {
        updated++;
      }
    } catch (err) {
      console.log(`  ✗ Patient/${p.id}: ${(err as Error).message}`);
    }
  }
  console.log(`Listo. Pacientes con bots ejecutados: ${updated}/${patients.length}.`);
}

/**
 * Agrupa las Subscriptions por el bot al que disparan.
 *
 * Función pura: decidir cuál se conserva y cuáles sobran no debe depender del
 * servidor. Se conserva la MÁS VIEJA (la que viene disparando) y sobran las
 * demás, para que borrar sea lo menos disruptivo posible.
 */
export function duplicadasPorEndpoint(
  subs: Subscription[]
): Map<string, { conservar: Subscription; sobran: Subscription[] }> {
  const porEndpoint = new Map<string, Subscription[]>();
  for (const s of subs) {
    const endpoint = s.channel?.endpoint;
    if (!endpoint?.startsWith('Bot/')) {
      continue;
    }
    porEndpoint.set(endpoint, [...(porEndpoint.get(endpoint) ?? []), s]);
  }

  const resultado = new Map<string, { conservar: Subscription; sobran: Subscription[] }>();
  for (const [endpoint, lista] of porEndpoint) {
    if (lista.length < 2) {
      continue;
    }
    const ordenadas = [...lista].sort((a, b) => (a.meta?.lastUpdated ?? '').localeCompare(b.meta?.lastUpdated ?? ''));
    resultado.set(endpoint, { conservar: ordenadas[0], sobran: ordenadas.slice(1) });
  }
  return resultado;
}

/**
 * Deja UNA Subscription por bot.
 *
 * Las duplicadas no son inofensivas: cada una dispara el bot por separado, así
 * que tres Subscriptions al mismo bot son tres recálculos por cada laboratorio
 * y tres alertas al médico de cabecera por el mismo hallazgo.
 */
async function dedupeSubscriptions(medplum: MedplumClient): Promise<void> {
  const subs = (await medplum.searchResources('Subscription', { _count: '200' })) as Subscription[];
  const duplicadas = duplicadasPorEndpoint(subs);
  if (duplicadas.size === 0) {
    console.log(`Sin duplicados: ${subs.length} Subscription(s), una por bot como mucho.`);
    return;
  }

  const aplicar = process.argv.includes('--apply');
  console.log(aplicar ? 'Modo: APLICAR\n' : 'Modo: SIMULACIÓN (agregá --apply para borrar)\n');
  for (const [endpoint, { conservar, sobran }] of duplicadas) {
    console.log(`${endpoint}: ${sobran.length + 1} Subscriptions`);
    console.log(`  conservar Subscription/${conservar.id} (${conservar.meta?.lastUpdated})`);
    for (const s of sobran) {
      if (aplicar) {
        await medplum.deleteResource('Subscription', s.id as string);
        console.log(`  ✗ borrada  Subscription/${s.id}`);
      } else {
        console.log(`  · sobra    Subscription/${s.id} (${s.meta?.lastUpdated})`);
      }
    }
  }
  if (!aplicar) {
    console.log('\nRepetí con --apply para borrarlas.');
  } else {
    console.log('\nListo. Verificá con: npm run ckm-bots-doctor');
  }
}

/** Artefacto que produce `npm run build:bots` y que consume el deploy. */
const BUNDLE_FILE = 'data/core/example-bots.json';

export interface VeredictoCodigo {
  coincide: boolean;
  bytesLocal: number;
  bytesDesplegado: number;
  /** true si lo desplegado parece el bot de ejemplo que crea el servidor. */
  esPlantilla: boolean;
}

/**
 * Compara el código que se quiso desplegar con el que quedó en el servidor.
 *
 * Existe porque "✓ desplegado" no prueba nada: el servidor puede haber
 * aceptado el $deploy y seguir sirviendo otro código. Un bot recién creado por
 * `admin/projects/{id}/bot` nace con el ejemplo "Hello world" del template, y
 * si el despliegue del código real no llegó a aplicarse, el bot ejecuta ese
 * ejemplo — corre bien, no falla, y no hace nada. Sin comparar los dos códigos
 * ese caso es indistinguible de un bot sano que no tenía nada que hacer.
 */
export function compararCodigo(local: string, desplegado: string): VeredictoCodigo {
  return {
    coincide: local.trim() === desplegado.trim(),
    bytesLocal: local.length,
    bytesDesplegado: desplegado.length,
    esPlantilla: /Hello world/i.test(desplegado) && desplegado.length < 2000,
  };
}

/** El JavaScript de cada bot dentro del bundle, por nombre de bot. */
export function codigoDelBundle(bundle: Bundle): Map<string, string> {
  const porUrl = new Map<string, string>();
  for (const e of bundle.entry ?? []) {
    const r = e.resource as { resourceType?: string; data?: string } | undefined;
    if (e.fullUrl && r?.resourceType === 'Binary' && r.data) {
      porUrl.set(e.fullUrl, Buffer.from(r.data, 'base64').toString('utf8'));
    }
  }
  const porBot = new Map<string, string>();
  for (const e of bundle.entry ?? []) {
    const r = e.resource as { resourceType?: string; name?: string; executableCode?: { url?: string } } | undefined;
    if (r?.resourceType === 'Bot' && r.name) {
      const codigo = porUrl.get(r.executableCode?.url ?? '');
      if (codigo) {
        porBot.set(r.name, codigo);
      }
    }
  }
  return porBot;
}

/**
 * ¿El servidor está ejecutando el código de este repo?
 *
 * Un bot que corre sin error y no escribe nada no dice si el problema es el
 * código o los datos. Esto lo separa: si lo desplegado no coincide con el
 * bundle, no hay nada que depurar en la lógica.
 */
async function checkCode(medplum: MedplumClient): Promise<void> {
  if (!fs.existsSync(BUNDLE_FILE)) {
    console.log(`No existe ${BUNDLE_FILE}. Corré primero: npm run build:bots`);
    return;
  }
  const porBot = codigoDelBundle(JSON.parse(fs.readFileSync(BUNDLE_FILE, 'utf8')) as Bundle);
  let discrepancias = 0;
  let ilegibles = 0;

  console.log('── CÓDIGO DESPLEGADO vs BUNDLE LOCAL ──\n');
  for (const { nombre } of BOTS) {
    const local = porBot.get(nombre);
    if (!local) {
      console.log(`  ? ${nombre}: no está en el bundle local (¿build:bots desactualizado?)`);
      continue;
    }
    const bot = await buscarBotPropio(medplum, nombre);
    if (!bot) {
      console.log(`  ✗ ${nombre}: no existe en este proyecto`);
      discrepancias++;
      continue;
    }
    const url = bot.executableCode?.url;
    if (!url) {
      console.log(`  ✗ ${nombre}: sin código ejecutable desplegado`);
      discrepancias++;
      continue;
    }
    try {
      const desplegado = await descargarTexto(medplum, url);

      // El bucket puede contestar un XML de error con status 200. Comparar eso
      // contra el código daría "DISTINTO" y mandaría a redesplegar un bot que
      // quizás está bien: acá no se sabe qué código corre, se sabe que no se
      // puede leer.
      const errStorage = errorDeStorage(desplegado);
      if (errStorage) {
        console.log(`  ? ${nombre}: no pude LEER el código desplegado — ${describirErrorDeStorage(errStorage)}`);
        console.log('     No dice nada sobre qué código ejecuta el Lambda. Para eso, corré el bot:');
        console.log('       npm run ckm-bots-doctor -- --reprocess <PatientId>');
        ilegibles++;
        continue;
      }

      const v = compararCodigo(local, desplegado);
      if (v.coincide) {
        console.log(`  ✓ ${nombre}: el servidor ejecuta el código del repo (${v.bytesDesplegado} bytes)`);
        continue;
      }
      discrepancias++;
      console.log(`  ✗ ${nombre}: DISTINTO — local ${v.bytesLocal} bytes, desplegado ${v.bytesDesplegado}`);
      if (v.esPlantilla) {
        console.log('     Lo desplegado es el bot de EJEMPLO del servidor ("Hello world"): el');
        console.log('     $deploy del código real nunca se aplicó. El bot corre, no falla y no hace nada.');
      }
      console.log(`     primera línea desplegada: ${desplegado.split('\n')[0]?.slice(0, 120)}`);
    } catch (err) {
      console.log(`  ? ${nombre}: no pude bajar el código desplegado — ${(err as Error).message}`);
    }
  }

  if (ilegibles > 0) {
    console.log(`\n${ilegibles} bot(s) con el código ILEGIBLE: el storage no entrega el Binary.`);
    console.log('  Este chequeo no puede opinar sobre ellos. Es un problema del servidor Medplum');
    console.log('  (bucket de Binary mal configurado o los objetos no están), y afecta a cualquier');
    console.log('  lectura de Binary del proyecto, no solo a los bots.');
    console.log('  Para saber qué código ejecuta un bot, corrélo: --reprocess <PatientId>.');
  }
  if (discrepancias > 0) {
    console.log(`\n${discrepancias} bot(s) no ejecutan el código de este repo.`);
    console.log('Re-desplegá y volvé a correr este chequeo:');
    console.log('  npm run build:bots && npm run deploy-bots-server && npm run ckm-bots-doctor -- --check-code');
  } else if (ilegibles === 0) {
    console.log('\nTodos los bots ejecutan el código de este repo.');
  }
}

/**
 * Crea una ProjectMembership para cada bot CKM en el proyecto ACTUAL si no la
 * tiene. Sin ella, el disparo por Subscription falla con "Could not find
 * project membership for bot" (el bot se creó en otro proyecto que la sub).
 */
async function fixBotMembership(medplum: MedplumClient): Promise<void> {
  const projectId = medplum.getProject()?.id;
  console.log(`Asegurando membership de los bots CKM en el proyecto ${projectId}...`);
  for (const name of CKM_BOT_NAMES) {
    const bot = await buscarBotPropio(medplum, name);
    if (!bot) {
      console.log(`  ✗ ${name}: bot no encontrado`);
      continue;
    }
    const memberships = await medplum.searchResources('ProjectMembership', `profile=Bot/${bot.id}`);
    const inThisProject = memberships.find((m) => m.project?.reference === `Project/${projectId}`);
    if (inThisProject) {
      console.log(`  · ${name}: ya tiene membership en este proyecto (${inThisProject.id})`);
      continue;
    }
    try {
      const created = await medplum.createResource({
        resourceType: 'ProjectMembership',
        project: { reference: `Project/${projectId}` },
        user: { reference: `Bot/${bot.id}` },
        profile: { reference: `Bot/${bot.id}` },
      });
      console.log(`  ✓ ${name}: membership creada en ${projectId} (${created.id})`);
    } catch (err) {
      console.log(`  ✗ ${name}: no se pudo crear la membership — ${(err as Error).message}`);
    }
  }
  console.log('\nVerificá con: npm run verify-prevent (la subscription debería disparar el bot).');
}

// Ejecutar SOLO cuando se corre como script: importar el módulo desde los tests
// de las funciones puras no debe intentar conectarse a nada.
const esEntrada = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (esEntrada) {
  main().catch((err) => {
    console.error('\n✗ Error:', err.message ?? err);
    process.exit(1);
  });
}

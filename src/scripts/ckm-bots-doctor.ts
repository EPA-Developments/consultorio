// Diagnóstico y reparación de los bots/subscriptions CKM en el servidor.
//
// El código del repo está correcto (criteria limpias, lógica de los bots OK).
// Los síntomas ("SDOH sin responder", labs que no impactan) suelen venir del
// ESTADO del servidor: un bot sin lambda desplegado, o una Subscription vieja
// que el redeploy no actualiza por el ifNoneExist (url=channel.endpoint).
//
// Subcomandos (no destructivos por defecto):
//   npm run ckm-bots-doctor              -> status (bots, subscriptions, audit)
//   npm run ckm-bots-doctor -- --reset-subs   -> borra las subs CKM (para
//                                                 recrearlas limpias con deploy)
//   npm run ckm-bots-doctor -- --reprocess <PatientId>  -> re-ejecuta los bots
//                                                 sobre los recursos existentes
//
// Requiere MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET (admin de proyecto).
import { MedplumClient } from '@medplum/core';
import type { Observation, QuestionnaireResponse } from '@medplum/fhirtypes';
import { SDOH_QUESTIONNAIRE_URL } from '../ckm/constants';
import { CKM_OBSERVATION_CODES } from '../ckm/observations';

const CKM_BOT_NAMES = ['ckm-recalculate', 'sdoh-response', 'ckm-alerts'];

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
    const bot = await medplum.searchOne('Bot', `name=${name}`);
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
  console.log(`   ckm-recalculate: Observation?code=${CKM_OBSERVATION_CODES.join(',')}`);
  console.log(`   sdoh-response:   QuestionnaireResponse?questionnaire=${SDOH_QUESTIONNAIRE_URL}`);

  console.log('\n── AUDITEVENTS recientes de los bots (¿corrió?, ¿error?) ──');
  for (const name of CKM_BOT_NAMES) {
    const bot = await medplum.searchOne('Bot', `name=${name}`);
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
      console.log(
        `     ${a.recorded} outcome=${a.outcome ?? '?'} ${a.outcomeDesc ? '— ' + a.outcomeDesc.slice(0, 160) : ''}`
      );
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
    { name: 'ckm-recalculate', criteria: `Observation?code=${CKM_OBSERVATION_CODES.join(',')}` },
    { name: 'sdoh-response', criteria: `QuestionnaireResponse?questionnaire=${SDOH_QUESTIONNAIRE_URL}` },
    // Mismos códigos que ckm-recalculate: dos Subscriptions sobre el mismo
    // criteria, una por bot, para que las alertas no puedan frenar el recálculo.
    { name: 'ckm-alerts', criteria: `Observation?code=${CKM_OBSERVATION_CODES.join(',')}` },
  ];
  for (const spec of specs) {
    const bot = await medplum.searchOne('Bot', `name=${spec.name}`);
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
  const sdohBot = await medplum.searchOne('Bot', 'name=sdoh-response');
  const responses = await medplum.searchResources('QuestionnaireResponse', {
    subject: `Patient/${patientId}`,
    questionnaire: SDOH_QUESTIONNAIRE_URL,
    _sort: '-_lastUpdated',
    _count: '1',
  });
  if (sdohBot && responses.length > 0) {
    await medplum.post(medplum.fhirUrl('Bot', sdohBot.id as string, '$execute'), responses[0] as QuestionnaireResponse);
    console.log(`  ✓ sdoh-response ejecutado sobre QuestionnaireResponse/${responses[0].id}`);
  } else {
    console.log(
      `  · SDOH: ${sdohBot ? 'sin QuestionnaireResponse del canónico para este paciente' : 'bot no encontrado'}`
    );
  }

  // CKM: última Observation CKM (dispara el recálculo de hGraph/estadío/PREVENT)
  const ckmBot = await medplum.searchOne('Bot', 'name=ckm-recalculate');
  const obs = await medplum.searchResources('Observation', {
    subject: `Patient/${patientId}`,
    code: CKM_OBSERVATION_CODES.join(','),
    _sort: '-_lastUpdated',
    _count: '1',
  });
  if (ckmBot && obs.length > 0) {
    await medplum.post(medplum.fhirUrl('Bot', ckmBot.id as string, '$execute'), obs[0] as Observation);
    console.log(`  ✓ ckm-recalculate ejecutado sobre Observation/${obs[0].id}`);
  } else {
    console.log(`  · CKM: ${ckmBot ? 'sin Observation CKM para este paciente' : 'bot no encontrado'}`);
  }

  console.log('\nVerificá el Patient: las extensiones hGraph/CKM/PREVENTInputs deben tener lastUpdated nuevo.');
}

/** Ejecuta los bots (vía $execute) sobre el último recurso de cada tipo del
 *  paciente. Devuelve cuántos $execute hizo. Silencioso salvo errores. */
async function runBotsForPatient(medplum: MedplumClient, patientId: string): Promise<number> {
  let ran = 0;
  const sdohBot = await medplum.searchOne('Bot', 'name=sdoh-response');
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
  const ckmBot = await medplum.searchOne('Bot', 'name=ckm-recalculate');
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
 * Crea una ProjectMembership para cada bot CKM en el proyecto ACTUAL si no la
 * tiene. Sin ella, el disparo por Subscription falla con "Could not find
 * project membership for bot" (el bot se creó en otro proyecto que la sub).
 */
async function fixBotMembership(medplum: MedplumClient): Promise<void> {
  const projectId = medplum.getProject()?.id;
  console.log(`Asegurando membership de los bots CKM en el proyecto ${projectId}...`);
  for (const name of CKM_BOT_NAMES) {
    const bot = await medplum.searchOne('Bot', `name=${name}`);
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

main().catch((err) => {
  console.error('\n✗ Error:', err.message ?? err);
  process.exit(1);
});

// Valida EN EL SERVIDOR el bot careplan-generate (CarePlan IA) de punta a punta.
//
// Usa un paciente de prueba dedicado con contexto CKM, limpia sus planes
// previos, dispara el bot vía executeBot (SÍNCRONO: devuelve el error real al
// instante) y verifica que se haya creado un CarePlan 'draft' + Goal + Task.
//
// Requiere que el bot esté desplegado (npm run deploy-bots-server) y con el
// secret ANTHROPIC_API_KEY cargado, y que el Lambda tenga salida a
// api.anthropic.com.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run verify-careplan
import { MedplumClient } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { CKM_STAGE_URL, HGRAPH_DATA_URL } from '../ckm/constants';
import { upsertUnico } from './lib/upsert';

const TEST_IDENTIFIER_SYSTEM = 'https://seguimiento.medplum.com.ar/fhir/test';
const TEST_IDENTIFIER_VALUE = 'ckm-careplan-test';
const BOT_NAME = 'careplan-generate';

/** Borra los recursos de un tipo que matcheen una búsqueda (limpieza previa). */
async function deleteWhere(
  medplum: MedplumClient,
  type: Parameters<MedplumClient['searchResources']>[0],
  query: string
): Promise<number> {
  const found = await medplum.searchResources(type, query);
  for (const r of found) {
    await medplum.deleteResource(type, r.id as string);
  }
  return found.length;
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  console.log(`Proyecto del client: ${medplum.getProject()?.id} en ${baseUrl}\n`);

  // 1. Paciente de prueba con contexto CKM (para que el LLM tenga insumos).
  const patient = await upsertUnico<Patient>(
    medplum,
    {
      resourceType: 'Patient',
      identifier: [{ system: TEST_IDENTIFIER_SYSTEM, value: TEST_IDENTIFIER_VALUE }],
      name: [{ given: ['Prueba'], family: 'CarePlan CKM' }],
      gender: 'male',
      birthDate: '1965-05-10',
      extension: [
        { url: CKM_STAGE_URL, valueInteger: 2 },
        {
          url: HGRAPH_DATA_URL,
          valueString: JSON.stringify({
            metrics: [
              { id: 'sbp', label: 'Presión sistólica', value: 148, unit: 'mmHg', score: 0.4, status: 'high' },
              { id: 'bmi', label: 'IMC', value: 31, unit: 'kg/m²', score: 0.4, status: 'moderate' },
              { id: 'hba1c', label: 'HbA1c', value: 6.8, unit: '%', score: 0.4, status: 'moderate' },
            ],
            prevent: { ascvd10y: 14.2, hf10y: 7.1, cvdTotal30y: 32.5 },
          }),
        },
      ],
    },
    `identifier=${encodeURIComponent(`${TEST_IDENTIFIER_SYSTEM}|${TEST_IDENTIFIER_VALUE}`)}`
  );
  const pid = patient.id as string;
  console.log(`1. Paciente de prueba: Patient/${pid} (estadío 2, contexto CKM cargado)`);

  // 2. Limpiar planes previos para una corrida limpia.
  const cp = await deleteWhere(medplum, 'CarePlan', `subject=Patient/${pid}`);
  const goals = await deleteWhere(medplum, 'Goal', `subject=Patient/${pid}`);
  const tasks = await deleteWhere(medplum, 'Task', `patient=Patient/${pid}`);
  console.log(`2. Limpieza previa: ${cp} CarePlan, ${goals} Goal, ${tasks} Task`);

  // 3. Disparar el bot (síncrono). Acá aparece el error real si falla.
  const bot = await medplum.searchOne('Bot', `name=${BOT_NAME}`);
  if (!bot?.id) {
    console.log(`\n✗ El bot ${BOT_NAME} no existe en el proyecto. Desplegá: npm run deploy-bots-server`);
    process.exit(1);
  }
  console.log(`3. Ejecutando Bot/${bot.id} (puede tardar ~10-30s mientras genera el plan)...`);
  try {
    await medplum.executeBot(bot.id, patient, 'application/fhir+json');
  } catch (err) {
    await diagnose(medplum, bot.id, (err as Error).message ?? String(err));
    process.exit(1);
  }

  // 4. Verificar lo creado.
  const plans = await medplum.searchResources('CarePlan', `subject=Patient/${pid}&_sort=-_lastUpdated`);
  const draft = plans.find((p) => p.status === 'draft');
  const createdGoals = await medplum.searchResources('Goal', `subject=Patient/${pid}`);
  const createdTasks = await medplum.searchResources('Task', `patient=Patient/${pid}`);

  console.log('\n── Resultado ──────────────────────────────');
  console.log(`  CarePlan 'draft': ${draft ? '1 ✓' : '0 ✗'}`);
  if (draft) {
    console.log(`    título: ${draft.title}`);
    console.log(`    resumen: ${(draft.description ?? '').slice(0, 160)}…`);
    console.log(`    actividades: ${draft.activity?.length ?? 0}`);
  }
  console.log(`  Goal (objetivos): ${createdGoals.length} ${createdGoals.length > 0 ? '✓' : '✗'}`);
  console.log(`  Task (controles): ${createdTasks.length} ${createdTasks.length > 0 ? '✓' : '✗'}`);

  if (draft && createdGoals.length > 0) {
    console.log('\n✓ OK: CarePlan IA funciona. Recargá el chart (Ctrl+Shift+R) y probá "Generar con IA".');
  } else {
    console.log('\n✗ El bot ejecutó pero no creó el plan esperado. Revisá los AuditEvents arriba.');
    process.exit(1);
  }
}

/** Imprime un diagnóstico del fallo: versión del código, API key, red, refusal. */
async function diagnose(medplum: MedplumClient, botId: string, message: string): Promise<void> {
  console.log(`\n✗ El bot falló: ${message}\n`);
  console.log('── Diagnóstico ────────────────────────────');
  if (/ANTHROPIC_API_KEY/i.test(message)) {
    console.log('  → Falta el secret ANTHROPIC_API_KEY en el Bot (app.medplum.com.ar → Bot → Secrets).');
  } else if (/refusal|declinó/i.test(message)) {
    console.log('  → El modelo declinó (refusal). Reintentá o ajustá el contexto del paciente.');
  } else if (/ENOTFOUND|fetch failed|ETIMEDOUT|network|getaddrinfo/i.test(message)) {
    console.log('  → El Lambda del bot no pudo alcanzar api.anthropic.com (egress del VPC/Security Group).');
  } else if (/HTTP 401|HTTP 403/i.test(message)) {
    console.log('  → API key inválida o sin permisos (401/403 de Anthropic).');
  }

  // Versión del código desplegado.
  const codeUrl = (await medplum.readResource('Bot', botId)).executableCode?.url;
  if (codeUrl) {
    try {
      const code = await (await medplum.download(codeUrl)).text();
      const ok = code.includes('crear_plan_bienestar');
      // Bot.executableCode puede quedar viejo si el deploy salteó la transacción
      // "strict isolation" (el Lambda igual corre el código nuevo vía $deploy),
      // así que un "NO" acá NO es concluyente.
      console.log(
        `  executableCode del recurso tiene la tool: ${ok ? 'SÍ ✓' : 'NO (puede ser falso negativo del deploy)'}`
      );
    } catch {
      /* best-effort */
    }
  }

  // AuditEvents recientes del bot.
  try {
    const audits = await medplum.searchResources('AuditEvent', {
      entity: `Bot/${botId}`,
      _count: '3',
      _sort: '-_lastUpdated',
    });
    console.log(`  AuditEvents recientes: ${audits.length}`);
    for (const a of audits) {
      console.log(
        `    ${a.recorded} outcome=${a.outcome ?? '?'} ${a.outcomeDesc ? '— ' + a.outcomeDesc.slice(0, 300) : ''}`
      );
    }
  } catch {
    /* best-effort */
  }
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message ?? err);
  process.exit(1);
});

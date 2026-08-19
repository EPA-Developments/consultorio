// Valida EN EL SERVIDOR la regla de alertas "3 strikes" del bot ckm-recalculate.
//
// Usa un paciente de prueba dedicado (identificado por un identifier propio),
// limpia su estado en cada corrida (para no chocar con el cooldown de 30 días),
// carga 3 registros de presión arterial elevada y espera a que el bot
// (Subscription async) cree el DetectedIssue + Task + Communication esperados.
//
// NO envía emails: el paciente de prueba no tiene generalPractitioner con email,
// así que el bot crea los recursos pero no manda correo.
//
// Requiere que el bot ya esté desplegado (npm run deploy-bots-server) y con su
// ProjectMembership creada (npm run ckm-bots-doctor -- --fix-bot-membership).
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run verify-alerts
import { MedplumClient } from '@medplum/core';
import type { Observation, Patient } from '@medplum/fhirtypes';
import {
  CKM_STAGE_URL,
  HGRAPH_DATA_URL,
  LOINC,
  LOINC_BP_PANEL,
  LOINC_SYSTEM,
  PREVENT_INPUTS_URL,
} from '../ckm/constants';
import { ALERT_RULE_SYSTEM } from '../ckm/alert-rules';
import { upsertUnico } from './lib/upsert';

const TEST_IDENTIFIER_SYSTEM = 'https://seguimiento.medplum.com.ar/fhir/test';
const TEST_IDENTIFIER_VALUE = 'ckm-alert-3strikes';
const RULE_ID = 'sbp-high';
const POLL_ATTEMPTS = 24;
const POLL_INTERVAL_MS = 2500;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function bpPanel(patientId: string, systolic: number, diastolic: number, date: string): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: date,
    code: { coding: [{ system: LOINC_SYSTEM, code: LOINC_BP_PANEL }] },
    component: [
      {
        code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.sbp }] },
        valueQuantity: { value: systolic, unit: 'mmHg' },
      },
      {
        code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.dbp }] },
        valueQuantity: { value: diastolic, unit: 'mmHg' },
      },
    ],
  };
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Borra los recursos de un tipo que matcheen una búsqueda (para limpiar estado). */
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

  // 1. Paciente de prueba dedicado (idempotente por identifier)
  const patient = await upsertUnico<Patient>(
    medplum,
    {
      resourceType: 'Patient',
      identifier: [{ system: TEST_IDENTIFIER_SYSTEM, value: TEST_IDENTIFIER_VALUE }],
      name: [{ given: ['Prueba'], family: 'Alertas CKM' }],
      gender: 'male',
      birthDate: '1968-01-01',
    },
    `identifier=${encodeURIComponent(`${TEST_IDENTIFIER_SYSTEM}|${TEST_IDENTIFIER_VALUE}`)}`
  );
  const pid = patient.id as string;
  console.log(`1. Paciente de prueba: Patient/${pid}`);

  // 2. Reset de estado para que la corrida sea limpia (evita el cooldown)
  const subj = `subject=Patient/${pid}`;
  const pat = `patient=Patient/${pid}`;
  const obs = await deleteWhere(medplum, 'Observation', subj);
  const di = await deleteWhere(medplum, 'DetectedIssue', pat);
  const tasks = await deleteWhere(medplum, 'Task', pat);
  const comms = await deleteWhere(medplum, 'Communication', subj);
  console.log(
    `2. Estado previo limpiado: ${obs} Observation, ${di} DetectedIssue, ${tasks} Task, ${comms} Communication`
  );

  // 3. Cargar 3 PA elevadas (sistólica >=140, diastólica normal, no críticas)
  console.log('3. Cargando 3 registros de PA elevada (145, 148, 150 mmHg)...');
  await medplum.createResource(bpPanel(pid, 145, 85, daysAgoIso(2)));
  await medplum.createResource(bpPanel(pid, 148, 86, daysAgoIso(1)));
  await medplum.createResource(bpPanel(pid, 150, 84, daysAgoIso(0)));

  // 4. Esperar a que el bot (Subscription async) cree el DetectedIssue
  console.log(`4. Esperando al bot (hasta ${(POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s)...`);
  let detected = false;
  for (let i = 0; i < POLL_ATTEMPTS && !detected; i++) {
    await sleep(POLL_INTERVAL_MS);
    const issues = await medplum.searchResources(
      'DetectedIssue',
      `${pat}&code=${encodeURIComponent(`${ALERT_RULE_SYSTEM}|${RULE_ID}`)}`
    );
    if (issues.length > 0) {
      detected = true;
    } else {
      process.stdout.write('.');
    }
  }
  process.stdout.write('\n');

  // 5. Reportar
  const issues = await medplum.searchResources('DetectedIssue', pat);
  const taskList = await medplum.searchResources('Task', pat);
  const commList = await medplum.searchResources('Communication', `${subj}&category=alert`);

  console.log('\n── Resultado ──────────────────────────────');
  console.log(`  DetectedIssue: ${issues.length}  ${issues.length > 0 ? '✓' : '✗'}`);
  issues.forEach((x) => console.log(`    · ${x.code?.coding?.[0]?.code ?? x.code?.text}: ${x.detail}`));
  console.log(`  Task (revisión): ${taskList.length}  ${taskList.length > 0 ? '✓' : '✗'}`);
  console.log(`  Communication 'alert': ${commList.length}  ${commList.length > 0 ? '✓' : '✗'}`);

  if (detected && taskList.length > 0 && commList.length > 0) {
    console.log('\n✓ OK: la regla "3 strikes" disparó y creó DetectedIssue + Task + Communication.');
    return;
  }

  await diagnose(medplum, pid);
  process.exit(1);
}

/**
 * Diagnostica por qué no apareció la alerta. Discrimina las dos causas raíz:
 *   A) el bot NO corrió  -> el Patient no tiene extensiones CKM nuevas (sub/membership)
 *   B) el bot corrió pero el camino de tendencia falló -> código viejo o AccessPolicy
 * y vuelca los AuditEvents recientes del bot (outcome + descripción del error).
 */
async function diagnose(medplum: MedplumClient, patientId: string): Promise<void> {
  console.log('\n── Diagnóstico ────────────────────────────');

  // 1. ¿Corrió el bot? Se ve en las extensiones CKM del Patient de prueba.
  try {
    const patient = await medplum.readResource('Patient', patientId);
    const has = (url: string): boolean => Boolean(patient.extension?.some((e) => e.url === url));
    const ran = has(CKM_STAGE_URL) || has(HGRAPH_DATA_URL) || has(PREVENT_INPUTS_URL);
    console.log(
      `  Bot corrió sobre el paciente: ${ran ? 'SÍ' : 'NO'}  (CKMStage=${has(CKM_STAGE_URL)} hGraph=${has(HGRAPH_DATA_URL)})`
    );
    if (!ran) {
      console.log(
        '  → El bot NO se ejecutó. Causa típica: la Subscription no dispara o falta\n' +
          '    la membership del bot. Probá:\n' +
          '      npm run ckm-bots-doctor                          (status: deployed?, sub activa?, accessPolicy?)\n' +
          '      npm run ckm-bots-doctor -- --fix-bot-membership\n' +
          `      npm run ckm-bots-doctor -- --reprocess ${patientId}   (ejecuta el bot vía $execute y muestra errores)`
      );
    } else {
      console.log(
        '  → El bot SÍ se ejecutó pero NO creó la alerta de tendencia. Causas probables:\n' +
          '    a) El bot tiene CÓDIGO VIEJO (sin la regla 3 strikes): redesplegá\n' +
          '         npm run build:bots && npm run deploy-bots-server\n' +
          '    b) La AccessPolicy del bot le impide crear DetectedIssue/Task (el bot\n' +
          '       traga el error). Mirá el accessPolicy en: npm run ckm-bots-doctor'
      );
    }
  } catch (err) {
    console.log(`  No pude releer el Patient de prueba: ${(err as Error).message}`);
  }

  // 2. AuditEvents recientes del bot: ¿corrió?, ¿con qué error?
  try {
    const bot = await medplum.searchOne('Bot', 'name=ckm-recalculate');
    if (!bot) {
      console.log('  Bot ckm-recalculate: NO existe en este proyecto.');
      return;
    }
    console.log(
      `  Bot ckm-recalculate: Bot/${bot.id} — código ejecutable ${bot.executableCode?.url ? 'presente' : 'AUSENTE (no desplegado)'}`
    );

    // Chequeo DEFINITIVO de versión: bajar el código desplegado y ver si tiene
    // la regla 3 strikes. Si no la tiene, el Lambda quedó con código viejo.
    const codeUrl = bot.executableCode?.url;
    if (codeUrl) {
      try {
        const blob = await medplum.download(codeUrl);
        const code = await blob.text();
        const hasRule = code.includes(ALERT_RULE_SYSTEM) || code.includes('ckm-alert-rule');
        console.log(
          `  Código DESPLEGADO tiene la regla 3 strikes: ${hasRule ? 'SÍ ✓' : 'NO ✗  → es código VIEJO, redesplegá'}`
        );
        if (!hasRule) {
          console.log(
            '      npm run build:bots && npm run deploy-bots-server   (y verificá "✓ ckm-recalculate desplegado")'
          );
        }
      } catch (err) {
        console.log(`  (no pude bajar el código desplegado para verificar versión: ${(err as Error).message})`);
      }
    }

    const audits = await medplum.searchResources('AuditEvent', {
      entity: `Bot/${bot.id}`,
      _count: '5',
      _sort: '-_lastUpdated',
    });
    console.log(`  AuditEvents recientes del bot: ${audits.length}`);
    for (const a of audits) {
      console.log(
        `    ${a.recorded} outcome=${a.outcome ?? '?'} ${a.outcomeDesc ? '— ' + a.outcomeDesc.slice(0, 300) : ''}`
      );
    }
    if (audits.length === 0) {
      console.log('    (sin AuditEvents: el bot no se está ejecutando; revisá la Subscription)');
    }
  } catch (err) {
    console.log(`  No pude leer AuditEvents del bot: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message ?? err);
  process.exit(1);
});

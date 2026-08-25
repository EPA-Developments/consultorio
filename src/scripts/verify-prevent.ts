// Smoke-test de producción del bot ckm-recalculate (modelo PREVENT base).
//
// Crea en el servidor el paciente de referencia oficial (mujer 50a, SBP 160
// tratada, colesterol 200 / HDL 45, diabética, eGFR 90, IMC 35), deja que el
// bot desplegado recalcule, y compara los scores PREVENT que escribió el bot
// contra los que produce el motor local validado (computePrevent). Si
// coinciden, el bot en producción está calculando correctamente.
//
// Requiere que el bot ckm-recalculate y su Subscription ya estén desplegados
// (Upload Example Bots). Idempotente por identifier.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run verify-prevent
//   ... npm run verify-prevent -- --cleanup   (borra el paciente de prueba)
import { MedplumClient, sleep } from '@medplum/core';
import type { Observation, Patient } from '@medplum/fhirtypes';
import { buscarBotPropio } from '../bot-lookup';
import { BOT_CKM_RECALCULATE } from '../bot-names';
import { LOINC, LOINC_BP_PANEL, LOINC_SYSTEM } from '../ckm/constants';
import { getHGraphData } from '../ckm/extensions';
import { computePrevent } from '../ckm/prevent';
import type { PreventInputs } from '../ckm/prevent';
import { upsertUnico } from './lib/upsert';

const SYSTEM = 'https://seguimiento.medplum.com.ar/seed-patient';
const TEST_ID = 'ckm-prevent-ref';

const REFERENCE: PreventInputs = {
  age: 50,
  sex: 'female',
  totalCholesterol: 200,
  hdl: 45,
  systolicBP: 160,
  egfr: 90,
  bmi: 35,
  diabetes: true,
  smoking: false,
  onAntihypertensive: true,
  onStatin: false,
};

function obs(patientId: string, code: string, value: number, unit: string): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: new Date().toISOString(),
    code: { coding: [{ system: LOINC_SYSTEM, code }] },
    valueQuantity: { value, unit },
  };
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

  // Chequeo previo: ¿está desplegado el bot y su Subscription?
  const bot = await buscarBotPropio(medplum, BOT_CKM_RECALCULATE);
  const subs = await medplum.searchResources('Subscription', { _count: '50' });
  const ckmSub = subs.find((s) => s.criteria?.startsWith('Observation?code=') && s.reason === BOT_CKM_RECALCULATE);
  console.log(`Bot ${BOT_CKM_RECALCULATE}: ${bot ? `Bot/${bot.id}` : 'NO ENCONTRADO'}`);
  console.log(`Subscription del bot: ${ckmSub ? `${ckmSub.id} (status=${ckmSub.status})` : 'NO ENCONTRADA'}`);
  if (!bot || !ckmSub || ckmSub.status !== 'active') {
    console.log(
      '\n✗ El bot o su Subscription no están desplegados/activos. Subí el bundle desde Upload Example Bots\n' +
        '  (npm run build:bots y luego /upload/bots) y verificá que la Subscription quede en status=active.'
    );
    if (!process.argv.includes('--cleanup')) {
      process.exit(1);
    }
  }

  // Paciente de referencia (upsert por identifier). Edad exactamente 50.
  const birthYear = new Date().getFullYear() - REFERENCE.age;
  const patient = await upsertUnico<Patient>(
    medplum,
    {
      resourceType: 'Patient',
      identifier: [{ system: SYSTEM, value: TEST_ID }],
      name: [{ given: ['PREVENT'], family: 'Referencia' }],
      gender: 'female',
      birthDate: `${birthYear}-01-01`,
    },
    `identifier=${SYSTEM}|${TEST_ID}`
  );
  const pid = patient.id as string;
  // El id se imprime porque el paso siguiente cuando el bot no escribe es
  // ejecutarlo a mano sobre ESTE paciente:
  //   npm run ckm-bots-doctor -- --reprocess <pid>
  console.log(`Paciente de prueba: Patient/${pid}`);

  if (process.argv.includes('--cleanup')) {
    await medplum.deleteResource('Patient', pid);
    console.log(`Paciente de prueba ${pid} eliminado.`);
    return;
  }

  // Comorbilidad y medicación (idempotentes)
  await upsertUnico(
    medplum,
    {
      resourceType: 'Condition',
      identifier: [{ system: SYSTEM, value: `${TEST_ID}-dm` }],
      subject: { reference: `Patient/${pid}` },
      clinicalStatus: { coding: [{ code: 'active' }] },
      code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9' }] },
    },
    `identifier=${SYSTEM}|${TEST_ID}-dm`
  );
  await upsertUnico(
    medplum,
    {
      resourceType: 'MedicationRequest',
      identifier: [{ system: SYSTEM, value: `${TEST_ID}-med` }],
      status: 'active',
      intent: 'order',
      subject: { reference: `Patient/${pid}` },
      medicationCodeableConcept: { text: 'Enalapril 10 mg' },
    },
    `identifier=${SYSTEM}|${TEST_ID}-med`
  );

  // Observations: las de laboratorio primero, el panel de PA al final para que
  // el último disparo del bot vea todos los datos.
  await medplum.createResource(obs(pid, LOINC.cholesterolTotal, 200, 'mg/dL'));
  await medplum.createResource(obs(pid, LOINC.hdlc, 45, 'mg/dL'));
  await medplum.createResource(obs(pid, LOINC.egfr, 90, 'mL/min/1.73m²'));
  await medplum.createResource(obs(pid, LOINC.bmi, 35, 'kg/m²'));
  await medplum.createResource({
    resourceType: 'Observation',
    status: 'final',
    subject: { reference: `Patient/${pid}` },
    effectiveDateTime: new Date().toISOString(),
    code: { coding: [{ system: LOINC_SYSTEM, code: LOINC_BP_PANEL }] },
    component: [
      { code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.sbp }] }, valueQuantity: { value: 160, unit: 'mmHg' } },
      { code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.dbp }] }, valueQuantity: { value: 90, unit: 'mmHg' } },
    ],
  });

  const expected = computePrevent(REFERENCE);
  console.log('\nMotor local (validado):', expected);
  console.log('Esperando a que el bot desplegado recalcule...');

  // Poll: detectar si el bot escribió ALGO (metrics) y si calculó PREVENT
  let fresh = await medplum.readResource('Patient', pid);
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    fresh = await medplum.readResource('Patient', pid);
    const data = getHGraphData(fresh);
    if (data.prevent?.ascvd10y === expected?.ascvd10y) {
      break;
    }
    const ran = (data.metrics?.length ?? 0) > 0 ? `metrics=${data.metrics?.length}` : 'sin métricas';
    console.log(`  intento ${i + 1}/20: ${ran}, prevent=${data.prevent ? JSON.stringify(data.prevent) : 'undefined'}`);
  }

  const finalData = getHGraphData(fresh);
  const serverPrevent = finalData.prevent;
  const obsCount = (await medplum.searchResources('Observation', { subject: `Patient/${pid}`, _count: '50' })).length;

  console.log('\n── Diagnóstico ──');
  console.log(`Observations del paciente: ${obsCount}`);
  console.log(`hGraph metrics escritas por el bot: ${finalData.metrics?.length ?? 0}`);
  console.log(`Scores PREVENT del servidor: ${serverPrevent ? JSON.stringify(serverPrevent) : 'undefined'}`);

  // Dato decisivo: distingue "la Subscription no disparó" (sin AuditEvents) de
  // "disparó y el bot falló" (AuditEvents con outcome de error). Sin esto el
  // diagnóstico se queda en "no se ejecutó" sin decir por qué.
  await dumpBotAudits(medplum, bot?.id);

  const ok =
    serverPrevent?.ascvd10y === expected?.ascvd10y &&
    serverPrevent?.hf10y === expected?.hf10y &&
    serverPrevent?.cvdTotal30y === expected?.cvdTotal30y;
  if (ok) {
    console.log('\n✓ OK: el bot en producción coincide con el motor validado.');
  } else if ((finalData.metrics?.length ?? 0) === 0) {
    console.log('\n✗ El bot NO se ejecutó (no escribió métricas). Causas probables:');
    console.log('  - El bot/Subscription no están desplegados o la Subscription no está activa.');
    console.log('  - El AccessPolicy del bot no le permite leer/escribir Patient u Observation.');
    console.log('\n  Si ARRIBA no hay AuditEvents, la Subscription no disparó y el problema no es');
    console.log('  el código del bot. Ejecutalo a mano para separar las dos causas:');
    console.log(`    npm run ckm-bots-doctor -- --reprocess ${pid}`);
  } else if (!serverPrevent) {
    console.log('\n✗ El bot corrió (escribió métricas) pero NO calculó PREVENT. Causas probables:');
    console.log('  - El AccessPolicy del bot no permite leer Condition o MedicationRequest.');
    console.log('  - Falta algún parámetro requerido (col total, HDL, SBP, eGFR, IMC) o la edad quedó fuera de 30-79.');
    console.log('  - El bundle desplegado es una versión anterior al cálculo PREVENT (re-subir build:bots).');
  } else {
    console.log('\n✗ El bot calculó PREVENT pero con valores distintos al motor validado.');
    console.log('  Probablemente el bundle desplegado tiene coeficientes/versión distintos (re-subir build:bots).');
  }
  if (!ok) {
    process.exit(1);
  }
}

/**
 * Vuelca los AuditEvents recientes del bot. Es el dato que separa las dos
 * causas posibles de "el bot no escribió":
 * - SIN AuditEvents  -> la Subscription no está disparando (problema de entrega).
 * - CON AuditEvents  -> el bot sí corrió; el outcome/outcomeDesc dice por qué falló.
 */
async function dumpBotAudits(medplum: MedplumClient, botId: string | undefined): Promise<void> {
  if (!botId) {
    return;
  }
  try {
    const audits = await medplum.searchResources('AuditEvent', {
      entity: `Bot/${botId}`,
      _count: '5',
      _sort: '-_lastUpdated',
    });
    console.log(`\nAuditEvents recientes del bot: ${audits.length}`);
    for (const a of audits) {
      console.log(
        `  ${a.recorded} outcome=${a.outcome ?? '?'}${a.outcomeDesc ? ' — ' + a.outcomeDesc.slice(0, 400) : ''}`
      );
    }
    if (audits.length === 0) {
      console.log('  (sin AuditEvents: el bot NO se está ejecutando — el problema es la ENTREGA de la');
      console.log('   Subscription, no el código del bot. Probar el disparo directo con:');
      console.log('   npm run ckm-bots-doctor -- --reprocess <PatientId>)');
    }
  } catch (err) {
    console.log(`\nNo pude leer AuditEvents del bot: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

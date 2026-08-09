// Diagnóstico de la verificación de matrícula contra REFEPS.
//
// Responde tres preguntas en orden, que son las que aparecen cuando algo no
// anda: ¿está el bot?, ¿están los secrets?, ¿qué contesta el registro?
//
// Subcomandos:
//   npm run refeps-doctor                          -> estado (bot + secrets)
//   npm run refeps-doctor -- --practitioner <Id>   -> ejecuta la verificación
//   npm run refeps-doctor -- --me                  -> verifica a todos los
//                                                     Practitioner del proyecto
//
// Requiere MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET (admin de proyecto).
//
// NUNCA imprime el valor de un secreto: solo si está o no está.
import { MedplumClient } from '@medplum/core';
import type { Practitioner, Project } from '@medplum/fhirtypes';
import { identifierIn, MATRICULA_SYSTEMS } from '../ckm/argentina';
import { REFEPS_BOT_NAME } from '../laborders/refeps-client';

/** Secrets que el bot necesita. `secreto: true` significa que no se imprime. */
const SECRETS = [
  { name: 'REFEPS_DOMAIN_SECRET', requerido: true, secreto: true },
  { name: 'REFEPS_DOMAIN_URL', requerido: true, secreto: false },
  { name: 'REFEPS_ENV', requerido: false, secreto: false },
];

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function matriculaDe(p: Practitioner): string | undefined {
  return identifierIn(p.identifier, MATRICULA_SYSTEMS);
}

function nombreDe(p: Practitioner): string {
  const n = p.name?.[0];
  return n?.text ?? [n?.given?.join(' '), n?.family].filter(Boolean).join(' ') ?? '(sin nombre)';
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
  console.log(`Conectado a ${baseUrl}`);
  console.log(`Proyecto: ${medplum.getProject()?.id}\n`);

  // ── 1. El bot ────────────────────────────────────────────────────────────
  console.log('── BOT ──');
  const bot = await medplum.searchOne('Bot', `name=${REFEPS_BOT_NAME}`);
  if (!bot) {
    console.log(`  ✗ No existe el bot "${REFEPS_BOT_NAME}".`);
    console.log('    Desplegarlo son DOS pasos, no uno:');
    console.log('      npm run build:bots');
    console.log('      MEDPLUM_CLIENT_ID=... MEDPLUM_CLIENT_SECRET=... npm run deploy-bots-server');
    return;
  }
  console.log(`  ✓ ${REFEPS_BOT_NAME} (${bot.id})`);
  console.log(`    runtime: ${bot.runtimeVersion ?? '(default)'} · timeout: ${bot.timeout ?? 10}s`);
  if ((bot.timeout ?? 10) < 30) {
    console.log('    ⚠ timeout bajo: son dos saltos de red contra el Bus. Re-desplegar para aplicar los 30s.');
  }
  if (!bot.executableCode) {
    console.log('    ✗ Sin código ejecutable desplegado: correr deploy-bots-server.');
  }

  // ── 2. Los secrets ───────────────────────────────────────────────────────
  console.log('\n── SECRETS DEL PROYECTO ──');
  console.log('  (van en Project.secret, no en el Bot: son del proyecto entero)');
  let faltaAlguno = false;
  const project = (await medplum.get(medplum.fhirUrl('Project', medplum.getProject()?.id as string))) as Project;
  for (const s of SECRETS) {
    const found = project.secret?.find((x) => x.name === s.name);
    if (!found?.valueString) {
      const marca = s.requerido ? '✗' : '·';
      console.log(`  ${marca} ${s.name}${s.requerido ? ' (requerido)' : ' (opcional)'} — sin cargar`);
      faltaAlguno ||= s.requerido;
      continue;
    }
    // El secreto no se imprime nunca: solo se confirma que está.
    const valor = s.secreto ? `cargado (${found.valueString.length} caracteres)` : found.valueString;
    console.log(`  ✓ ${s.name} — ${valor}`);
  }
  const env = project.secret?.find((x) => x.name === 'REFEPS_ENV')?.valueString;
  console.log(`\n  Ambiente efectivo: ${env === 'prod' ? 'PROD (bus.msal.gob.ar)' : 'QA (bus-test.msal.gob.ar)'}`);
  if (env !== 'prod') {
    console.log('  Mientras REFEPS_ENV no diga "prod", no se le pega a producción.');
  }
  if (faltaAlguno) {
    console.log('\n  Cargarlos en la app: Admin → Project → Secrets.');
    return;
  }

  // ── 3. La verificación ───────────────────────────────────────────────────
  const practitionerId = arg('--practitioner');
  const todos = process.argv.includes('--me');
  if (!practitionerId && !todos) {
    console.log('\nPara probar contra el registro:');
    console.log('  npm run refeps-doctor -- --me');
    console.log('  npm run refeps-doctor -- --practitioner <PractitionerId>');
    return;
  }

  const practitioners = practitionerId
    ? [await medplum.readResource('Practitioner', practitionerId)]
    : await medplum.searchResources('Practitioner', { _count: '20' });

  console.log(`\n── VERIFICACIÓN (${practitioners.length} profesional/es) ──`);
  for (const p of practitioners) {
    const matricula = matriculaDe(p);
    console.log(`\n  ${nombreDe(p)} (${p.id})`);
    console.log(`    matrícula cargada: ${matricula ?? '(ninguna)'} · DNI/género: ${p.gender ?? '(sin género)'}`);
    try {
      const res = (await medplum.executeBot(bot.id as string, { practitionerId: p.id })) as Record<string, unknown>;
      console.log(`    veredicto: ${String(res.verdict)} — ${String(res.message)}`);
      if (res.queriedBy) {
        console.log(`    consultado por: ${String(res.queriedBy)} · ambiente: ${String(res.environment)}`);
      }
      const found = res.found as { value: string; profession?: string; jurisdiction?: string; enabled?: boolean }[];
      if (found?.length) {
        for (const m of found) {
          const detalle = [
            m.profession,
            m.jurisdiction,
            m.enabled === undefined ? 'sin dato de habilitación (v1)' : `habilitada=${m.enabled}`,
          ]
            .filter(Boolean)
            .join(' · ');
          console.log(`      REFEPS: ${m.value}${detalle ? ` (${detalle})` : ''}`);
        }
      }
    } catch (err) {
      // Un fallo acá NO significa matrícula inválida: puede ser el Bus caído.
      console.log(`    ⚠ no se pudo verificar: ${err instanceof Error ? err.message : String(err)}`);
      console.log('      (esto es "no disponible", no un rechazo del registro)');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

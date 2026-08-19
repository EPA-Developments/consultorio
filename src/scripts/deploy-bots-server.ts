// Despliega los bots del bundle al servidor Medplum de forma headless, sin
// depender de la página /upload/bots (que requiere que el usuario web sea
// admin y que su AccessPolicy permita Bot). Replica la lógica de
// UploadDataPage.uploadExampleBots usando las credenciales del
// ClientApplication.
//
// Requiere un ClientApplication con rol de admin de proyecto (para crear y
// desplegar Bots). Idempotente: actualiza y re-deploya los bots existentes.
//
// Uso:
//   npm run build:bots   (genera data/core/example-bots.json)
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run deploy-bots-server
import { MedplumClient } from '@medplum/core';
import type { Bot, Bundle, BundleEntry, Subscription } from '@medplum/fhirtypes';
import fs from 'fs';
import { pathToFileURL } from 'url';

const BUNDLE_FILE = 'data/core/example-bots.json';

/** El proyecto al que pertenece un recurso (meta.project, en extended mode). */
function proyectoDe(recurso: { meta?: unknown }): string | undefined {
  return (recurso.meta as { project?: string } | undefined)?.project;
}

/**
 * El Bot de ESTE proyecto con ese nombre, o undefined si hay que crearlo.
 *
 * No alcanza con `searchOne('Bot', {name})`, y esto no es teórico: un proyecto
 * que LINKEA a otro ve los recursos del linkeado, y los links encadenan. Con
 * Favaloro → Super Admin → Biowellness, buscar "ckm-recalculate" desde Favaloro
 * devolvía el bot de Biowellness, y el deploy terminaba pisando el código
 * ejecutable de los bots de PRODUCCIÓN de otro consultorio — sin un solo error,
 * reportando "Bot existente" con un id que no era de este proyecto.
 *
 * Un bot con el nombre correcto en el proyecto equivocado no es el bot: si los
 * candidatos son todos ajenos, corresponde CREAR el propio.
 *
 * Cuando `meta.project` no viene (credencial sin extended mode) no se puede
 * decidir, y ante la duda se aborta: desplegar sobre el proyecto de otro es
 * mucho peor que no desplegar.
 */
export async function botDelProyecto(
  medplum: MedplumClient,
  botName: string,
  projectId: string
): Promise<Bot | undefined> {
  const candidatos = (await medplum.searchResources('Bot', { name: botName, _count: '50' })) as Bot[];
  const exactos = candidatos.filter((b) => b.name === botName);
  if (exactos.length === 0) {
    return undefined;
  }

  const propios = exactos.filter((b) => proyectoDe(b) === projectId);
  if (propios.length > 0) {
    return propios[0];
  }

  const opacos = exactos.filter((b) => !proyectoDe(b));
  if (opacos.length > 0) {
    throw new Error(
      `No puedo determinar a qué proyecto pertenece el Bot «${botName}» (${opacos
        .map((b) => b.id)
        .join(', ')}): la búsqueda no devuelve meta.project.\n` +
        '  Sin ese dato, desplegar puede pisar el bot de otro proyecto linkeado.\n' +
        '  Usá un ClientApplication admin del proyecto, o verificá el bot a mano antes de seguir.'
    );
  }

  // Todos los candidatos son de otros proyectos (linkeados): este proyecto no
  // tiene el bot, hay que crearlo acá.
  console.log(
    `  · «${botName}» existe en otro proyecto (${exactos.map((b) => b.id).join(', ')}), no en este: se crea el propio.`
  );
  return undefined;
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }
  if (!fs.existsSync(BUNDLE_FILE)) {
    throw new Error(`No existe ${BUNDLE_FILE}. Corré primero: npm run build:bots`);
  }

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  const projectId = medplum.getProject()?.id;
  if (!projectId) {
    throw new Error('No se pudo determinar el proyecto del ClientApplication.');
  }
  console.log(`Proyecto ${projectId} en ${baseUrl}`);

  // Red de seguridad: los bots/subscriptions DEBEN quedar en el mismo proyecto
  // que los pacientes (los de Control). Si MEDPLUM_EXPECTED_PROJECT está seteado
  // y no coincide, abortar para no desplegar al proyecto equivocado.
  const expected = process.env.MEDPLUM_EXPECTED_PROJECT;
  if (expected && expected !== projectId) {
    throw new Error(
      `El client pertenece al proyecto ${projectId}, pero MEDPLUM_EXPECTED_PROJECT=${expected}.\n` +
        '  Las Subscriptions solo disparan dentro de su proyecto: usá un ClientApplication\n' +
        '  del proyecto donde viven los pacientes (Control). Deploy abortado.'
    );
  }

  const bundle = JSON.parse(fs.readFileSync(BUNDLE_FILE, 'utf8')) as Bundle;
  let transactionString = fs.readFileSync(BUNDLE_FILE, 'utf8');
  const botEntries: BundleEntry[] = (bundle.entry ?? []).filter((e) => e.resource?.resourceType === 'Bot');
  const botIds: Record<string, string> = {};

  // 1. Crear los Bots que falten y resolver los placeholders del bundle
  for (const entry of botEntries) {
    const botName = (entry.resource as Bot).name as string;
    const found = await botDelProyecto(medplum, botName, projectId);
    let bot: Bot;
    if (!found) {
      const url = new URL(`admin/projects/${projectId}/bot`, medplum.getBaseUrl());
      bot = (await medplum.post(url, { name: botName })) as Bot;
      console.log(`  + Bot creado: ${botName} (${bot.id})`);
    } else {
      bot = found;
      console.log(`  · Bot existente: ${botName} (${bot.id})`);
    }
    const botId = bot.id as string;
    botIds[botName] = botId;
    transactionString = transactionString
      .replaceAll(`$bot-${botName}-reference`, `Bot/${botId}`)
      .replaceAll(`$bot-${botName}-id`, botId);
  }

  // 2. Resolver placeholders de cuestionarios (para los bots de encuentro)
  const questionnaires = await medplum.searchResources('Questionnaire', { _count: '100' });
  for (const q of questionnaires) {
    if (q.name && q.id) {
      transactionString = transactionString.replaceAll(`$${q.name}`, `Questionnaire/${q.id}`);
    }
  }

  // 3. Ejecutar la transacción (Binarys + Bots + Subscriptions). En proyectos con
  //    "strict isolation" la transacción entera puede rechazarse por cantidad de
  //    entries. NO es fatal: el código EJECUTABLE se despliega igual en el paso 4
  //    ($deploy, que actualiza el Lambda y el Bot.executableCode), los Bots ya
  //    existen, y las Subscriptions se reconcilian en el paso 5.
  try {
    await medplum.executeBatch(JSON.parse(transactionString) as Bundle);
    console.log('  Transacción ejecutada (código fuente + suscripciones).');
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/strict isolation|too many entries/i.test(msg)) {
      console.log(`  ⚠ La transacción no se aplicó ("${msg}"). No es fatal.`);
      console.log('     El código ejecutable se despliega en el paso 4 y las Subscriptions se reconcilian en el 5.');
    } else {
      throw err;
    }
  }

  // 4. Desplegar el código ejecutable de cada bot a Lambda. Se continúa ante
  //    un fallo para no dejar a medias el resto y poder reportar el detalle.
  const failures: string[] = [];
  for (const entry of botEntries) {
    const botName = (entry.resource as Bot).name as string;
    const botId = botIds[botName];
    const wanted = (entry.resource as Bot).runtimeVersion ?? 'awslambda';
    try {
      // Reconciliar los metadatos del Bot uno por uno, acá y no en la
      // transacción del paso 3: esa transacción falla en servidores que limitan
      // las entradas con aislamiento estricto ("Transaction requires strict
      // isolation but has too many entries"), y entonces cambios como el
      // timeout nunca llegaban al servidor aunque el código sí se desplegara.
      // - runtimeVersion: un bot creado antes como 'vmcontext' falla con
      //   "Bots not enabled" si el servidor no los habilita.
      // - timeout: sin esto, un bot que llama a una API externa muere con
      //   "Sandbox.Timedout" a los 10 s (default del runtime).
      const wantedTimeout = (entry.resource as Bot).timeout;
      const serverBot = await medplum.readResource('Bot', botId);
      const changes: Partial<Bot> = {};
      if (serverBot.runtimeVersion !== wanted) {
        changes.runtimeVersion = wanted;
      }
      if (wantedTimeout !== undefined && serverBot.timeout !== wantedTimeout) {
        changes.timeout = wantedTimeout;
      }
      if (Object.keys(changes).length > 0) {
        await medplum.updateResource({ ...serverBot, ...changes });
        const detalle = [
          changes.runtimeVersion ? `runtimeVersion ${serverBot.runtimeVersion ?? '(sin)'} -> ${wanted}` : undefined,
          changes.timeout ? `timeout ${serverBot.timeout ?? '(default)'}s -> ${wantedTimeout}s` : undefined,
        ]
          .filter(Boolean)
          .join(', ');
        console.log(`  · ${botName}: ${detalle}`);
      }

      const distUrl = (entry.resource as Bot).executableCode?.url;
      const distEntry = (bundle.entry ?? []).find((e) => e.fullUrl === distUrl);
      const data = (distEntry?.resource as { data?: string })?.data;
      if (!data) {
        console.log(`  ! ${botName}: sin código ejecutable en el bundle, salteado`);
        continue;
      }
      const code = Buffer.from(data, 'base64').toString('utf8');
      await medplum.post(medplum.fhirUrl('Bot', botId, '$deploy'), { code });
      console.log(`  ✓ ${botName} desplegado (${wanted})`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.log(`  ✗ ${botName}: ${msg}`);
      failures.push(`${botName}: ${msg}`);
    }
  }

  // 5. Asegurar las Subscriptions, SIN depender de la transacción del paso 3.
  //    En este servidor esa transacción falla siempre ("too many entries"), y
  //    su ifNoneExist era el único camino por el que nacía la Subscription de
  //    un bot NUEVO: el bot quedaba desplegado y mudo — deployado pero fuera
  //    del circuito. Acá se reconcilia una por una, idempotente: crea la que
  //    falta y corrige la criteria si quedó vieja.
  const subsWanted = (JSON.parse(transactionString) as Bundle).entry
    ?.map((e) => e.resource)
    .filter((r): r is Subscription => r?.resourceType === 'Subscription');
  if (subsWanted && subsWanted.length > 0) {
    console.log('\nSubscriptions:');
    const existing = (await medplum.searchResources('Subscription', { _count: '100' })).filter(
      (s) => proyectoDe(s) === projectId
    );
    for (const wanted of subsWanted) {
      const endpoint = wanted.channel?.endpoint;
      const actual = existing.find((s) => s.channel?.endpoint === endpoint);
      if (!actual) {
        const created = await medplum.createResource(wanted);
        console.log(`  + creada ${wanted.reason}: ${created.id} -> ${endpoint}`);
      } else if (actual.criteria !== wanted.criteria || actual.status !== 'active') {
        await medplum.updateResource({ ...actual, criteria: wanted.criteria, status: 'active' });
        console.log(`  · actualizada ${wanted.reason}: criteria/status reconciliados (${actual.id})`);
      } else {
        console.log(`  ✓ ${wanted.reason}: ok (${actual.id})`);
      }
    }
  }

  if (failures.length > 0) {
    console.log('\n✗ Bots que no se desplegaron:');
    failures.forEach((f) => console.log('  - ' + f));
    if (failures.some((f) => /not enabled/i.test(f))) {
      console.log(
        '\n"Bots not enabled" suele ser config del servidor Medplum: faltan habilitar\n' +
          '  los bots de ese runtime. Para awslambda, verificá en medplum.config.json:\n' +
          '  botLambdaRoleArn y botLambdaLayerName configurados; para vmcontext,\n' +
          '  vmContextBotsEnabled: true.'
      );
    }
    process.exit(1);
  }
  console.log('\nListo. Verificá con: npm run verify-prevent');
}

// Ejecutar SOLO cuando se corre como script: importar el módulo desde los
// tests de las funciones puras no debe intentar conectarse a nada.
const esEntrada = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (esEntrada) {
  main().catch((err) => {
    console.error('\n✗ Error:', err.message ?? err);
    if (String(err).includes('Forbidden')) {
      console.error(
        '  El ClientApplication necesita rol de admin de proyecto para crear/desplegar Bots.\n' +
          '  En app.medplum.com.ar: Project → Clients → (tu client) → marcar Admin, o asignarle\n' +
          '  una membership admin sin AccessPolicy restrictiva.'
      );
    }
    process.exit(1);
  });
}

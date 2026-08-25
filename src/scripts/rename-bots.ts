// Migración de los Bots del proyecto a los nombres con prefijo (Camino A:
// renombrar EN EL LUGAR, sin crear bots nuevos).
//
// POR QUÉ RENOMBRAR EN VEZ DE REDESPLEGAR
//
// Cambiar el nombre en el repo no renombra nada en el servidor. Si se despliega
// sin migrar, `deploy-bots-server` no encuentra «favaloro-ckm-recalculate»,
// crea un Bot NUEVO, y el viejo queda vivo con su Subscription: dos
// Subscriptions sobre el mismo criteria, o sea cada laboratorio recalculando el
// estadío dos veces y las alertas duplicadas al médico de cabecera.
//
// Renombrar in-place conserva el id del Bot, su Lambda, su ProjectMembership y
// sus Subscriptions. Es reversible (el nombre viejo está en la tabla) y no deja
// ventana con bots duplicados.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run rename-bots
//        -> INVENTARIO Y PLAN, sin escribir nada
//   ... npm run rename-bots -- --apply
//        -> aplica los renombres
//
// Después: npm run build:bots && npm run deploy-bots-server
import { MedplumClient } from '@medplum/core';
import type { Bot, Subscription } from '@medplum/fhirtypes';
import { pathToFileURL } from 'url';
import { proyectoDe } from '../bot-lookup';
import type { IdentidadBot } from '../bot-names';
import { BOTS } from '../bot-names';
import { verificarProyecto } from './lib/proyecto';

export type AccionRenombre =
  /** Existe con el nombre viejo: hay que renombrarlo. */
  | 'renombrar'
  /** Ya tiene el nombre nuevo: nada que hacer. */
  | 'ya-migrado'
  /** No existe en este proyecto: lo va a crear el deploy. */
  | 'ausente'
  /** Existen los DOS. No se toca: hay que decidir a mano cuál sobrevive. */
  | 'conflicto';

export interface PasoRenombre {
  identidad: IdentidadBot;
  accion: AccionRenombre;
  /** El bot a renombrar, o el que ya tiene el nombre nuevo. */
  bot?: Bot;
  /** En un conflicto, el bot que ya ocupa el nombre nuevo. */
  ocupante?: Bot;
}

/**
 * Arma el plan a partir de los bots PROPIOS del proyecto. Función pura: la
 * decisión se testea sin servidor, y `--apply` no hace más que ejecutarla.
 */
export function planearRenombres(botsPropios: Bot[], identidades: IdentidadBot[] = BOTS): PasoRenombre[] {
  return identidades.map((identidad) => {
    const conNombreNuevo = botsPropios.find((b) => b.name === identidad.nombre);
    const conNombreViejo = botsPropios.find((b) => b.name === identidad.legado);
    if (conNombreNuevo && conNombreViejo) {
      return { identidad, accion: 'conflicto', bot: conNombreViejo, ocupante: conNombreNuevo };
    }
    if (conNombreNuevo) {
      return { identidad, accion: 'ya-migrado', bot: conNombreNuevo };
    }
    if (conNombreViejo) {
      return { identidad, accion: 'renombrar', bot: conNombreViejo };
    }
    return { identidad, accion: 'ausente' };
  });
}

/** Los bots del proyecto que este repo no maneja (restos de otros despliegues). */
export function botsAjenosAlRepo(botsPropios: Bot[], identidades: IdentidadBot[] = BOTS): Bot[] {
  const conocidos = new Set(identidades.flatMap((i) => [i.nombre, i.legado]));
  return botsPropios.filter((b) => !conocidos.has(b.name ?? ''));
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }
  const aplicar = process.argv.includes('--apply');

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  const projectId = verificarProyecto(medplum);
  console.log(`Proyecto ${projectId} en ${baseUrl}`);
  console.log(aplicar ? 'Modo: APLICAR\n' : 'Modo: SIMULACIÓN (agregá --apply para escribir)\n');

  // Inventario. Se filtra por meta.project a propósito: la búsqueda devuelve
  // también los bots de los proyectos linkeados, y renombrar el bot de otro
  // consultorio sería exactamente el accidente que esto viene a prevenir.
  const todos = (await medplum.searchResources('Bot', { _count: '200' })) as Bot[];
  const propios = todos.filter((b) => proyectoDe(b) === projectId);
  const opacos = todos.filter((b) => !proyectoDe(b));
  if (propios.length === 0 && opacos.length > 0) {
    throw new Error(
      'La búsqueda no devuelve meta.project, así que no puedo distinguir los bots de este\n' +
        '  proyecto de los de los proyectos linkeados. Usá un ClientApplication admin del proyecto.'
    );
  }

  console.log('── BOTS DE ESTE PROYECTO ──');
  for (const b of propios) {
    console.log(`  ${b.name ?? '(sin nombre)'} — Bot/${b.id}`);
  }
  if (opacos.length > 0) {
    console.log(`  (${opacos.length} bots visibles sin meta.project: de proyectos linkeados, NO se tocan)`);
  }

  const plan = planearRenombres(propios);
  console.log('\n── PLAN ──');
  const aRenombrar = plan.filter((p) => p.accion === 'renombrar');
  const conflictos = plan.filter((p) => p.accion === 'conflicto');
  for (const paso of plan) {
    const { identidad: i, accion, bot, ocupante } = paso;
    switch (accion) {
      case 'renombrar':
        console.log(`  → ${i.legado}  ⇒  ${i.nombre}   (Bot/${bot?.id})`);
        break;
      case 'ya-migrado':
        console.log(`  ✓ ${i.nombre}: ya migrado (Bot/${bot?.id})`);
        break;
      case 'ausente':
        console.log(`  · ${i.nombre}: no existe en este proyecto — lo va a crear el deploy`);
        break;
      case 'conflicto':
        console.log(
          `  ✗ ${i.nombre}: CONFLICTO — existen «${i.legado}» (Bot/${bot?.id}) y «${i.nombre}» (Bot/${ocupante?.id}).`
        );
        console.log('     No se toca. Decidí a mano cuál queda y borrá el otro con sus Subscriptions.');
        break;
    }
  }

  const restos = botsAjenosAlRepo(propios);
  if (restos.length > 0) {
    console.log('\n── BOTS DEL PROYECTO QUE ESTE REPO NO DESPLIEGA ──');
    console.log('  (no se tocan; si son restos de un template viejo, borralos desde el admin)');
    for (const b of restos) {
      console.log(`  ? ${b.name ?? '(sin nombre)'} — Bot/${b.id}`);
    }
  }

  if (aRenombrar.length === 0) {
    console.log(conflictos.length > 0 ? '\nNada que renombrar automáticamente.' : '\nNada que hacer: ya está migrado.');
    return;
  }
  if (!aplicar) {
    console.log(`\n${aRenombrar.length} bot(s) para renombrar. Repetí con --apply para escribir.`);
    return;
  }

  // Renombrar. Un PUT del recurso: NO toca executableCode ni el Lambda.
  console.log('\n── APLICANDO ──');
  const subs = (await medplum.searchResources('Subscription', { _count: '200' })) as Subscription[];
  for (const paso of aRenombrar) {
    const bot = paso.bot as Bot;
    await medplum.updateResource({ ...bot, name: paso.identidad.nombre });
    console.log(`  ✓ Bot/${bot.id}: «${paso.identidad.legado}» ⇒ «${paso.identidad.nombre}»`);

    // Subscription.reason guarda el nombre del bot, y los scripts de
    // verificación filtran por ahí. Se busca por endpoint (Bot/id), que es lo
    // único que no cambió.
    const propias = subs.filter((s) => proyectoDe(s) === projectId && s.channel?.endpoint === `Bot/${bot.id}`);
    for (const sub of propias) {
      if (sub.reason === paso.identidad.nombre) {
        continue;
      }
      await medplum.updateResource({ ...sub, reason: paso.identidad.nombre });
      console.log(`     · Subscription/${sub.id}: reason ⇒ «${paso.identidad.nombre}»`);
    }
  }

  console.log('\nListo. Ahora sí: npm run build:bots && npm run deploy-bots-server');
  console.log('Y después: npm run ckm-bots-doctor (debe ver los bots y UNA sola sub por bot).');
}

// Ejecutar SOLO como script: los tests importan las funciones puras.
const esEntrada = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (esEntrada) {
  main().catch((err) => {
    console.error('\n✗ Error:', err.message ?? err);
    process.exit(1);
  });
}

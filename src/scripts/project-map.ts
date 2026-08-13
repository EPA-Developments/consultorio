// Mapa de proyectos del servidor: qué hay en cada uno y quién puede verlo.
//
// Nace de un incidente real: ckm-bots-doctor, conectado al proyecto
// 7f068d7d, reportó "ckm-recalculate: NO existe" — y el mismo bot aparecía
// en ese mismo proyecto al mirarlo como super admin. Dos preguntas distintas:
// "¿existe el recurso?" y "¿puede verlo ESTA credencial?". Este script
// responde las dos, para todos los proyectos de una sola pasada.
//
// Además el servidor acumuló varios proyectos con los mismos nombres de bot
// (deploys de julio y de agosto), así que "está desplegado" dejó de ser una
// pregunta con respuesta única: hay que decir en cuál.
//
// ES DE SOLO LECTURA. No crea, no modifica y no borra nada.
//
// Requiere credenciales de SUPER ADMIN (el único rol que ve todos los
// proyectos). Dos formas:
//   MEDPLUM_ADMIN_EMAIL=admin@... MEDPLUM_ADMIN_PASSWORD=... npm run project-map
//   MEDPLUM_CLIENT_ID=... MEDPLUM_CLIENT_SECRET=... npm run project-map
//     (ese client debe pertenecer al proyecto Super Admin)
import { MedplumClient } from '@medplum/core';
import type {
  Bot,
  ClientApplication,
  Project,
  ProjectMembership,
  Resource,
  Subscription,
} from '@medplum/fhirtypes';
import { pathToFileURL } from 'url';

/** Tipos que se listan con detalle (son pocos y sus campos importan). */
const TIPOS_DETALLE = ['Bot', 'Subscription', 'ClientApplication', 'CodeSystem', 'ValueSet', 'Practitioner'] as const;
/** Tipos que solo se cuentan (pueden ser muchos: se piden en modo resumen). */
const TIPOS_VOLUMEN = ['Patient', 'Observation', 'MedicationRequest', 'ServiceRequest'] as const;

type TipoContado = (typeof TIPOS_DETALLE)[number] | (typeof TIPOS_VOLUMEN)[number];
const TIPOS_CONTADOS: TipoContado[] = [...TIPOS_VOLUMEN, ...TIPOS_DETALLE];

/** Tope de páginas por tipo: acota el barrido en servidores grandes. */
const MAX_PAGINAS = 25;
const POR_PAGINA = 200;

// ── Parte pura (testeable) ──────────────────────────────────────────────────

/** El proyecto al que pertenece un recurso (meta.project, en extended mode). */
export function proyectoDe(recurso: Resource): string | undefined {
  return (recurso.meta as { project?: string } | undefined)?.project;
}

export function agruparPorProyecto<T extends Resource>(recursos: T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const r of recursos) {
    const clave = proyectoDe(r) ?? '(sin proyecto)';
    const lista = mapa.get(clave);
    if (lista) {
      lista.push(r);
    } else {
      mapa.set(clave, [r]);
    }
  }
  return mapa;
}

export interface CredencialProyecto {
  id: string;
  nombre: string;
  admin: boolean;
  /** AccessPolicy de la membership del client, si tiene. */
  policy?: string;
}

export interface ResumenProyecto {
  id: string;
  nombre: string;
  superAdmin: boolean;
  features: string[];
  conteos: Partial<Record<TipoContado, number>>;
  truncados: Partial<Record<TipoContado, boolean>>;
  bots: { nombre: string; id: string; desplegado: boolean }[];
  subscriptions: { reason?: string; status?: string }[];
  clients: CredencialProyecto[];
}

export interface Hallazgo {
  nivel: 'ok' | 'aviso' | 'problema';
  texto: string;
}

/**
 * Conclusiones del mapa. Las dos preguntas que importan: ¿las piezas que
 * TIENEN que convivir están en el mismo proyecto? Y ¿hay credenciales con
 * AccessPolicy que expliquen un "no existe" que en realidad es "no lo veo"?
 */
export function analizar(resumenes: ResumenProyecto[], botsEsperados: string[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const clinicos = resumenes.filter((r) => !r.superAdmin);
  const conPacientes = clinicos.filter((r) => (r.conteos.Patient ?? 0) > 0);
  const conBots = clinicos.filter((r) => r.bots.length > 0);

  const principal = [...conPacientes].sort((a, b) => (b.conteos.Patient ?? 0) - (a.conteos.Patient ?? 0))[0];
  if (!principal) {
    hallazgos.push({ nivel: 'problema', texto: 'Ningún proyecto tiene pacientes: revisar credenciales o servidor.' });
    return hallazgos;
  }
  hallazgos.push({
    nivel: 'ok',
    texto: `Los pacientes viven en «${principal.nombre}» (${principal.id}): ${principal.conteos.Patient} Patient.`,
  });
  if (conPacientes.length > 1) {
    hallazgos.push({
      nivel: 'aviso',
      texto:
        `Hay pacientes en ${conPacientes.length} proyectos: ` +
        conPacientes.map((p) => `${p.nombre} (${p.conteos.Patient})`).join(', ') +
        '. Hay que saber cuál usa el Dashboard.',
    });
  }

  // Bots duplicados entre proyectos: la causa de las subscriptions fantasma.
  for (const nombre of botsEsperados) {
    const donde = conBots.filter((p) => p.bots.some((b) => b.nombre === nombre));
    if (donde.length === 0) {
      hallazgos.push({ nivel: 'problema', texto: `El bot ${nombre} no existe en NINGÚN proyecto.` });
    } else if (donde.length > 1) {
      hallazgos.push({
        nivel: 'aviso',
        texto: `El bot ${nombre} existe en ${donde.length} proyectos: ${donde.map((p) => `${p.nombre} (${p.id})`).join(', ')}. Solo el del proyecto de los pacientes cuenta.`,
      });
    }
    const enPrincipal = principal.bots.find((b) => b.nombre === nombre);
    if (enPrincipal && !enPrincipal.desplegado) {
      hallazgos.push({
        nivel: 'problema',
        texto: `${nombre} existe en «${principal.nombre}» pero SIN código ejecutable desplegado.`,
      });
    }
  }

  const faltantesEnPrincipal = botsEsperados.filter((n) => !principal.bots.some((b) => b.nombre === n));
  if (faltantesEnPrincipal.length > 0) {
    hallazgos.push({
      nivel: 'problema',
      texto: `Faltan en el proyecto de los pacientes: ${faltantesEnPrincipal.join(', ')}.`,
    });
  }

  const activas = principal.subscriptions.filter((s) => s.status === 'active');
  if (principal.bots.length > 0 && activas.length === 0) {
    hallazgos.push({
      nivel: 'problema',
      texto: `«${principal.nombre}» tiene bots pero ninguna Subscription activa: no se disparan solos.`,
    });
  }

  // Terminología: el vademécum tiene que estar donde entra el Dashboard.
  const terminologia = clinicos.filter((r) => (r.conteos.CodeSystem ?? 0) > 0 || (r.conteos.ValueSet ?? 0) > 0);
  const enPrincipal = (principal.conteos.CodeSystem ?? 0) > 0 || (principal.conteos.ValueSet ?? 0) > 0;
  if (!enPrincipal && terminologia.length > 0) {
    hallazgos.push({
      nivel: 'problema',
      texto:
        'La terminología está en ' +
        terminologia.map((p) => `${p.nombre} (${p.id})`).join(', ') +
        `, no en «${principal.nombre}»: el buscador del Dashboard no la ve.`,
    });
  } else if (enPrincipal) {
    hallazgos.push({ nivel: 'ok', texto: 'La terminología está en el proyecto de los pacientes.' });
  }

  if (!principal.features.includes('bots')) {
    hallazgos.push({
      nivel: 'problema',
      texto: `«${principal.nombre}» no tiene la feature "bots": las Subscriptions no dispararán bots ahí.`,
    });
  }

  // La causa de "existe pero no lo veo": credenciales con AccessPolicy.
  for (const p of clinicos) {
    for (const c of p.clients.filter((c) => c.policy)) {
      hallazgos.push({
        nivel: 'aviso',
        texto: `El client «${c.nombre}» de «${p.nombre}» tiene AccessPolicy ${c.policy}: si esa policy no incluye Bot o Subscription, los scripts que usen esas credenciales van a reportar "NO existe" aunque el recurso esté.`,
      });
    }
  }

  return hallazgos;
}

// ── Conexión ────────────────────────────────────────────────────────────────

async function conectar(): Promise<MedplumClient> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const medplum = new MedplumClient({ baseUrl, fetch });
  const email = process.env.MEDPLUM_ADMIN_EMAIL;
  const password = process.env.MEDPLUM_ADMIN_PASSWORD;
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

  if (email && password) {
    let login = (await medplum.startLogin({ email, password })) as {
      login?: string;
      code?: string;
      memberships?: { id: string; project?: { reference?: string; display?: string } }[];
    };
    if (login.memberships?.length) {
      // Con varias membresías hay que elegir: la de super admin es la que ve
      // todos los proyectos. Se puede fijar con MEDPLUM_ADMIN_PROJECT.
      const preferido = process.env.MEDPLUM_ADMIN_PROJECT;
      const elegida =
        (preferido
          ? login.memberships.find((m) => m.project?.reference?.endsWith(preferido) || m.id === preferido)
          : undefined) ??
        login.memberships.find((m) => /super/i.test(m.project?.display ?? '')) ??
        login.memberships[0];
      console.log(`Membresías: ${login.memberships.map((m) => m.project?.display ?? m.id).join(' · ')}`);
      console.log(`Usando: ${elegida.project?.display ?? elegida.id}`);
      login = (await medplum.post('auth/profile', { login: login.login, profile: elegida.id })) as typeof login;
    }
    if (login.code) {
      await medplum.processCode(login.code);
    }
  } else if (clientId && clientSecret) {
    await medplum.startClientLogin(clientId, clientSecret);
  } else {
    throw new Error(
      'Faltan credenciales de super admin.\n' +
        '  MEDPLUM_ADMIN_EMAIL + MEDPLUM_ADMIN_PASSWORD  (usuario super admin), o\n' +
        '  MEDPLUM_CLIENT_ID + MEDPLUM_CLIENT_SECRET     (client del proyecto Super Admin)'
    );
  }
  console.log(`Conectado a ${baseUrl}\n`);
  return medplum;
}

/** Barre un tipo con tope de páginas. `resumen` achica el payload. */
async function barrer(
  medplum: MedplumClient,
  tipo: TipoContado,
  resumen: boolean
): Promise<{ recursos: Resource[]; truncado: boolean }> {
  const recursos: Resource[] = [];
  let paginas = 0;
  const query: Record<string, string> = { _count: String(POR_PAGINA) };
  if (resumen) {
    // Solo para contar: trae los elementos de resumen (meta incluida).
    query._summary = 'true';
  }
  try {
    for await (const pagina of medplum.searchResourcePages(tipo, query)) {
      recursos.push(...(pagina as Resource[]));
      if (++paginas >= MAX_PAGINAS) {
        return { recursos, truncado: true };
      }
    }
  } catch (err) {
    console.log(`  ⚠ No pude listar ${tipo}: ${(err as Error).message}`);
  }
  return { recursos, truncado: false };
}

async function main(): Promise<void> {
  const botsEsperados = ['ckm-recalculate', 'sdoh-response', 'ckm-alerts'];
  const medplum = await conectar();

  const proyectos = (await medplum.searchResources('Project', { _count: '100' })) as Project[];
  if (proyectos.length === 0) {
    throw new Error('No veo ningún Project: estas credenciales no son de super admin.');
  }
  console.log(`Proyectos en el servidor: ${proyectos.length}\n`);

  const porTipo = new Map<TipoContado, { mapa: Map<string, Resource[]>; truncado: boolean }>();
  for (const tipo of TIPOS_CONTADOS) {
    const esVolumen = (TIPOS_VOLUMEN as readonly string[]).includes(tipo);
    const { recursos, truncado } = await barrer(medplum, tipo, esVolumen);
    porTipo.set(tipo, { mapa: agruparPorProyecto(recursos), truncado });
  }
  const membresias = (await medplum
    .searchResources('ProjectMembership', { _count: '500' })
    .catch(() => [])) as ProjectMembership[];

  const resumenes: ResumenProyecto[] = proyectos.map((p) => {
    const pid = p.id as string;
    const conteos: Partial<Record<TipoContado, number>> = {};
    const truncados: Partial<Record<TipoContado, boolean>> = {};
    for (const tipo of TIPOS_CONTADOS) {
      const entrada = porTipo.get(tipo);
      conteos[tipo] = entrada?.mapa.get(pid)?.length ?? 0;
      truncados[tipo] = entrada?.truncado ?? false;
    }
    const bots = ((porTipo.get('Bot')?.mapa.get(pid) ?? []) as Bot[])
      .map((b) => ({
        nombre: b.name ?? '(sin nombre)',
        id: b.id as string,
        desplegado: Boolean(b.executableCode?.url),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const subscriptions = ((porTipo.get('Subscription')?.mapa.get(pid) ?? []) as Subscription[]).map((s) => ({
      reason: s.reason,
      status: s.status,
    }));
    const clients = ((porTipo.get('ClientApplication')?.mapa.get(pid) ?? []) as ClientApplication[]).map((c) => {
      const m = membresias.find((mm) => mm.profile?.reference === `ClientApplication/${c.id}`);
      return {
        id: c.id as string,
        nombre: c.name ?? '(sin nombre)',
        admin: Boolean(m?.admin),
        policy: m?.accessPolicy?.display ?? m?.accessPolicy?.reference,
      };
    });
    return {
      id: pid,
      nombre: p.name ?? '(sin nombre)',
      superAdmin: Boolean(p.superAdmin),
      features: p.features ?? [],
      conteos,
      truncados,
      bots,
      subscriptions,
      clients,
    };
  });

  for (const r of resumenes) {
    console.log(`── ${r.nombre}${r.superAdmin ? '  [SUPER ADMIN]' : ''} ──`);
    console.log(`   id: ${r.id}`);
    console.log(`   features: ${r.features.length ? r.features.join(', ') : '(ninguna)'}`);
    const linea = TIPOS_CONTADOS.filter((t) => (r.conteos[t] ?? 0) > 0)
      .map((t) => `${t}: ${r.conteos[t]}${r.truncados[t] ? '+' : ''}`)
      .join(' · ');
    console.log(`   ${linea || '(vacío)'}`);
    for (const b of r.bots) {
      console.log(`   bot ${b.nombre}: Bot/${b.id} — código ${b.desplegado ? 'desplegado' : 'AUSENTE'}`);
    }
    for (const s of r.subscriptions.filter((s) => s.reason)) {
      console.log(`   subscription: reason=${s.reason} status=${s.status ?? '?'}`);
    }
    for (const c of r.clients) {
      console.log(
        `   client «${c.nombre}»: ${c.id} — admin=${c.admin} — accessPolicy=${c.policy ?? '(ninguna)'}`
      );
    }
    console.log('');
  }

  console.log('── Veredicto ──');
  for (const h of analizar(resumenes, botsEsperados)) {
    console.log(`${h.nivel === 'ok' ? '✓' : h.nivel === 'aviso' ? '•' : '✗'} ${h.texto}`);
  }
  console.log('\n(El "+" en un conteo significa que el barrido se cortó por el tope de páginas.)');
}

// Ejecutar SOLO cuando se corre como script: importar el módulo desde los
// tests de las funciones puras no debe intentar conectarse a nada.
const esEntrada = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (esEntrada) {
  main().catch((err) => {
    console.error('\n✗ Error:', err.message ?? err);
    process.exit(1);
  });
}

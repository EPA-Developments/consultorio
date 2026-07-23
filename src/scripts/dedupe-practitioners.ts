// Diagnóstico y limpieza de Practitioners DUPLICADOS del proyecto (el que
// corresponda a las credenciales del ClientApplication, ej. "Biowellness San
// Isidro"). Aparecen duplicados cuando un login o un seed crea un Practitioner
// nuevo cada vez en lugar de reutilizar el existente.
//
// Qué hace:
//   1. Trae todos los Practitioners y los agrupa por nombre normalizado (ignora
//      acentos, apóstrofes y mayúsculas, así "Dalessandro" y "D'Alessandro"
//      caen en el mismo grupo).
//   2. Para cada Practitioner cuenta quién lo referencia:
//      - ProjectMembership.profile  → es una CUENTA DE LOGIN (no se debe borrar).
//      - Patient.generalPractitioner, Encounter, ServiceRequest, Observation,
//        ClinicalImpression, DiagnosticReport, CareTeam, Appointment,
//        Communication → datos clínicos que lo usan.
//   3. Marca cada uno: LOGIN / REFERENCIADO / HUÉRFANO (seguro de borrar).
//   4. Recomienda cuál conservar (el "original") por grupo.
//
// Por defecto es DRY-RUN (no borra nada). Con --delete-orphans borra SOLO los
// duplicados huérfanos (0 logins y 0 referencias), nunca el que se conserva ni
// uno referenciado ni una cuenta de login.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run dedupe-practitioners
//   ... npm run dedupe-practitioners -- --name="Dos Santos"   # filtrar por nombre
//   ... npm run dedupe-practitioners -- --delete-orphans      # borrar huérfanos
import { MedplumClient, getReferenceString } from '@medplum/core';
import type { Practitioner, ResourceType } from '@medplum/fhirtypes';

/** Reverse-searches que indican que un Practitioner está en uso. */
const REFERENCES: Array<{ resourceType: ResourceType; param: string }> = [
  { resourceType: 'Patient', param: 'general-practitioner' },
  { resourceType: 'Encounter', param: 'participant' },
  { resourceType: 'ServiceRequest', param: 'requester' },
  { resourceType: 'ServiceRequest', param: 'performer' },
  { resourceType: 'Observation', param: 'performer' },
  { resourceType: 'DiagnosticReport', param: 'performer' },
  { resourceType: 'ClinicalImpression', param: 'assessor' },
  { resourceType: 'CareTeam', param: 'participant' },
  { resourceType: 'Appointment', param: 'actor' },
  { resourceType: 'Communication', param: 'sender' },
  { resourceType: 'Communication', param: 'recipient' },
];

interface Analysis {
  practitioner: Practitioner;
  name: string;
  matricula?: string;
  lastUpdated?: string;
  memberships: number;
  refs: number;
  /** Búsquedas que fallaron (param inexistente / sin permiso): no se pudo verificar. */
  unverified: string[];
}

/** Nombre para mostrar (prefijo + given + family). */
function displayName(p: Practitioner): string {
  const n = p.name?.[0];
  if (!n) {
    return '(sin nombre)';
  }
  return [n.prefix?.join(' '), n.given?.join(' '), n.family].filter(Boolean).join(' ');
}

/** Clave de agrupación: minúsculas, sin acentos, sin apóstrofes ni puntuación. */
function groupKey(p: Practitioner): string {
  const n = p.name?.[0];
  const raw = `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`;
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // acentos (marcas diacríticas combinantes)
    .replace(/['’.]/g, '') // apóstrofes (recto y tipográfico) y puntos
    .replace(/\s+/g, ' ')
    .trim();
}

async function countSearch(medplum: MedplumClient, resourceType: ResourceType, query: string): Promise<number> {
  const bundle = await medplum.search(resourceType, query + '&_summary=count');
  return bundle.total ?? 0;
}

async function analyze(medplum: MedplumClient, p: Practitioner): Promise<Analysis> {
  const ref = getReferenceString(p);
  const unverified: string[] = [];

  let memberships = 0;
  try {
    memberships = await countSearch(medplum, 'ProjectMembership', `profile=${ref}`);
  } catch {
    unverified.push('ProjectMembership.profile');
  }

  let refs = 0;
  for (const { resourceType, param } of REFERENCES) {
    try {
      refs += await countSearch(medplum, resourceType, `${param}=${ref}`);
    } catch {
      unverified.push(`${resourceType}.${param}`);
    }
  }

  return {
    practitioner: p,
    name: displayName(p),
    matricula: p.identifier?.find((i) => /matricula/i.test(i.system ?? ''))?.value,
    lastUpdated: p.meta?.lastUpdated,
    memberships,
    refs,
    unverified,
  };
}

/** Estado de un Practitioner para el reporte. */
function verdict(a: Analysis): 'LOGIN' | 'REFERENCIADO' | 'HUÉRFANO' {
  if (a.memberships > 0) {
    return 'LOGIN';
  }
  if (a.refs > 0) {
    return 'REFERENCIADO';
  }
  return 'HUÉRFANO';
}

/**
 * Elige el Practitioner a conservar en un grupo: prioriza el que es cuenta de
 * login; si no, el más referenciado; si empatan, el que tiene matrícula; y como
 * último criterio el más antiguo (meta.lastUpdated más viejo).
 */
function pickKeeper(group: Analysis[]): Analysis {
  return [...group].sort((a, b) => {
    if ((b.memberships > 0 ? 1 : 0) !== (a.memberships > 0 ? 1 : 0)) {
      return (b.memberships > 0 ? 1 : 0) - (a.memberships > 0 ? 1 : 0);
    }
    if (b.refs !== a.refs) {
      return b.refs - a.refs;
    }
    if (!!b.matricula !== !!a.matricula) {
      return (b.matricula ? 1 : 0) - (a.matricula ? 1 : 0);
    }
    return (a.lastUpdated ?? '').localeCompare(b.lastUpdated ?? '');
  })[0];
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }
  const doDelete = process.argv.includes('--delete-orphans');
  const nameArg = process.argv.find((a) => a.startsWith('--name='))?.slice('--name='.length);

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  console.log(`Conectado a ${baseUrl}${nameArg ? ` · filtro nombre="${nameArg}"` : ''}\n`);

  const all = await medplum.searchResources('Practitioner', { _count: '1000' });
  const filtered = nameArg ? all.filter((p) => displayName(p).toLowerCase().includes(nameArg.toLowerCase())) : all;
  console.log(
    `Practitioners en el proyecto: ${all.length}${nameArg ? ` (coinciden con el filtro: ${filtered.length})` : ''}`
  );

  // Agrupar.
  const groups = new Map<string, Practitioner[]>();
  for (const p of filtered) {
    const key = groupKey(p);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`Grupos con duplicados: ${dupGroups.length}\n`);

  let deletable = 0;
  const toDelete: Practitioner[] = [];

  for (const group of dupGroups) {
    const analyses = await Promise.all(group.map((p) => analyze(medplum, p)));
    const keeper = pickKeeper(analyses);
    console.log('─'.repeat(72));
    console.log(`${analyses[0].name}  ·  ${analyses.length} copias`);
    for (const a of analyses) {
      const v = verdict(a);
      const isKeeper = a.practitioner.id === keeper.practitioner.id;
      const tag = isKeeper ? '★ CONSERVAR' : v === 'HUÉRFANO' ? '🗑  borrar' : '⚠  reasignar';
      const detail =
        v === 'LOGIN'
          ? `login (${a.memberships} membership)`
          : v === 'REFERENCIADO'
            ? `${a.refs} referencia(s)`
            : 'sin referencias';
      console.log(
        `  ${tag.padEnd(12)} ${a.practitioner.id}  [${v}] ${detail}` +
          `${a.matricula ? ` · Mat ${a.matricula}` : ''} · act. ${a.lastUpdated?.slice(0, 10) ?? '—'}`
      );
      if (a.unverified.length > 0) {
        console.log(`               (no verificable: ${a.unverified.join(', ')})`);
      }
      // Borrable = no es el keeper, es huérfano (0 login, 0 refs) y todo verificable.
      if (!isKeeper && v === 'HUÉRFANO' && a.unverified.length === 0) {
        deletable++;
        toDelete.push(a.practitioner);
      }
    }
    const needReassign = analyses.filter(
      (a) => a.practitioner.id !== keeper.practitioner.id && verdict(a) !== 'HUÉRFANO'
    );
    if (needReassign.length > 0) {
      console.log(
        `  → ${needReassign.length} duplicado(s) están EN USO: reasigná sus referencias al ★ (${keeper.practitioner.id}) antes de borrarlos.`
      );
    }
  }

  console.log('─'.repeat(72));
  console.log(`\nHuérfanos seguros de borrar: ${deletable}`);

  if (!doDelete) {
    console.log('\nDRY-RUN: no se borró nada. Para borrar los huérfanos: agregá  -- --delete-orphans');
    return;
  }
  console.log('\n--delete-orphans: borrando duplicados huérfanos...');
  let ok = 0;
  for (const p of toDelete) {
    try {
      await medplum.deleteResource('Practitioner', p.id as string);
      console.log(`  ✓ borrado ${p.id} (${displayName(p)})`);
      ok++;
    } catch (err) {
      console.log(`  ✗ error borrando ${p.id}: ${(err as Error).message}`);
    }
  }
  console.log(`\nBorrados: ${ok}/${toDelete.length}. Los duplicados EN USO se dejaron intactos (reasignar primero).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

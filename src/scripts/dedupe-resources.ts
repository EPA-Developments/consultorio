// Diagnóstico y limpieza de recursos DUPLICADOS del proyecto (el que corresponda
// a las credenciales del ClientApplication, ej. "Biowellness San Isidro").
// Soporta Practitioner (default) y Organization. Aparecen duplicados cuando un
// login, un seed o una carga manual crea un recurso nuevo cada vez en lugar de
// reutilizar el existente.
//
// Qué hace:
//   1. Trae todos los recursos del tipo y los agrupa por nombre normalizado
//      (ignora acentos, apóstrofes y mayúsculas, así "Dalessandro" y
//      "D'Alessandro" —o "Shanti OM" con y sin puntuación— caen en el mismo
//      grupo).
//   2. Por cada copia cuenta quién la referencia:
//      - Practitioner: ProjectMembership.profile (CUENTA DE LOGIN → no borrar) +
//        Patient.generalPractitioner, Encounter, ServiceRequest, Observation,
//        ClinicalImpression, DiagnosticReport, CareTeam, Appointment,
//        Communication.
//      - Organization: Patient.managingOrganization/generalPractitioner,
//        Encounter.serviceProvider, ServiceRequest, Observation,
//        DiagnosticReport, PractitionerRole, Location, HealthcareService,
//        Coverage.payor, Organization.partOf.
//   3. Marca cada copia: LOGIN / REFERENCIADO / HUÉRFANO (seguro de borrar).
//   4. Recomienda cuál conservar (la "original") por grupo.
//
// Por defecto es DRY-RUN (no borra nada). Con --delete-orphans borra SOLO los
// duplicados huérfanos (0 logins y 0 referencias), nunca el que se conserva ni
// uno referenciado ni una cuenta de login. Si algún conteo no se pudo verificar
// (permisos), ese recurso NO se borra.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run dedupe-practitioners
//   ... npm run dedupe-organizations                          # Organizations
//   ... npm run dedupe-practitioners -- --name="Dos Santos"   # filtrar
//   ... npm run dedupe-organizations -- --delete-orphans      # borrar huérfanos
import { MedplumClient, getReferenceString } from '@medplum/core';
import type { Organization, Practitioner, ResourceType } from '@medplum/fhirtypes';

type Dedupable = Practitioner | Organization;
type SupportedType = 'Practitioner' | 'Organization';

interface TypeConfig {
  /** Reverse-searches que indican que el recurso está en uso. */
  references: Array<{ resourceType: ResourceType; param: string }>;
  /** Si además hay que chequear ProjectMembership.profile (cuentas de login). */
  membership: boolean;
}

const CONFIG: Record<SupportedType, TypeConfig> = {
  Practitioner: {
    membership: true,
    references: [
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
    ],
  },
  Organization: {
    membership: false,
    references: [
      { resourceType: 'Patient', param: 'organization' }, // managingOrganization
      { resourceType: 'Patient', param: 'general-practitioner' },
      { resourceType: 'Encounter', param: 'service-provider' },
      { resourceType: 'ServiceRequest', param: 'requester' },
      { resourceType: 'ServiceRequest', param: 'performer' },
      { resourceType: 'Observation', param: 'performer' },
      { resourceType: 'DiagnosticReport', param: 'performer' },
      { resourceType: 'PractitionerRole', param: 'organization' },
      { resourceType: 'Location', param: 'organization' }, // managingOrganization
      { resourceType: 'HealthcareService', param: 'organization' },
      { resourceType: 'Coverage', param: 'payor' },
      { resourceType: 'Organization', param: 'partof' }, // orgs hijas
    ],
  },
};

interface Analysis {
  resource: Dedupable;
  label: string;
  secondaryId?: string;
  lastUpdated?: string;
  memberships: number;
  refs: number;
  /** Búsquedas que fallaron (param inexistente / sin permiso): no verificable. */
  unverified: string[];
}

/** Nombre para mostrar según el tipo. */
function labelOf(r: Dedupable): string {
  if (r.resourceType === 'Practitioner') {
    const n = r.name?.[0];
    return n ? [n.prefix?.join(' '), n.given?.join(' '), n.family].filter(Boolean).join(' ') : '(sin nombre)';
  }
  return r.name ?? '(sin nombre)';
}

/** Texto crudo para agrupar (nombre del recurso, sin normalizar aún). */
function rawName(r: Dedupable): string {
  if (r.resourceType === 'Practitioner') {
    const n = r.name?.[0];
    return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`;
  }
  return r.name ?? '';
}

/** Clave de agrupación: minúsculas, sin acentos, sin apóstrofes ni puntuación. */
function groupKey(r: Dedupable): string {
  return rawName(r)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // acentos (marcas diacríticas combinantes)
    .replace(/['’.,]/g, '') // apóstrofes (recto y tipográfico), puntos y comas
    .replace(/\s+/g, ' ')
    .trim();
}

/** Identificador secundario para mostrar (matrícula del Practitioner, o el 1er identifier). */
function secondaryIdOf(r: Dedupable): string | undefined {
  if (r.resourceType === 'Practitioner') {
    const mat = r.identifier?.find((i) => /matricula/i.test(i.system ?? ''))?.value;
    if (mat) {
      return `Mat ${mat}`;
    }
  }
  return r.identifier?.[0]?.value;
}

async function countSearch(medplum: MedplumClient, resourceType: ResourceType, query: string): Promise<number> {
  const bundle = await medplum.search(resourceType, query + '&_summary=count');
  return bundle.total ?? 0;
}

async function analyze(medplum: MedplumClient, r: Dedupable, config: TypeConfig): Promise<Analysis> {
  const ref = getReferenceString(r);
  const unverified: string[] = [];

  let memberships = 0;
  if (config.membership) {
    try {
      memberships = await countSearch(medplum, 'ProjectMembership', `profile=${ref}`);
    } catch {
      unverified.push('ProjectMembership.profile');
    }
  }

  let refs = 0;
  for (const { resourceType, param } of config.references) {
    try {
      refs += await countSearch(medplum, resourceType, `${param}=${ref}`);
    } catch {
      unverified.push(`${resourceType}.${param}`);
    }
  }

  return {
    resource: r,
    label: labelOf(r),
    secondaryId: secondaryIdOf(r),
    lastUpdated: r.meta?.lastUpdated,
    memberships,
    refs,
    unverified,
  };
}

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
 * Elige el recurso a conservar en un grupo: prioriza la cuenta de login (solo
 * Practitioner); si no, el más referenciado; si empatan, el que tiene id
 * secundario; y como último criterio el más antiguo (meta.lastUpdated).
 */
function pickKeeper(group: Analysis[]): Analysis {
  return [...group].sort((a, b) => {
    if ((b.memberships > 0 ? 1 : 0) !== (a.memberships > 0 ? 1 : 0)) {
      return (b.memberships > 0 ? 1 : 0) - (a.memberships > 0 ? 1 : 0);
    }
    if (b.refs !== a.refs) {
      return b.refs - a.refs;
    }
    if (!!b.secondaryId !== !!a.secondaryId) {
      return (b.secondaryId ? 1 : 0) - (a.secondaryId ? 1 : 0);
    }
    return (a.lastUpdated ?? '').localeCompare(b.lastUpdated ?? '');
  })[0];
}

function parseType(): SupportedType {
  const raw = process.argv.find((a) => a.startsWith('--type='))?.slice('--type='.length);
  if (raw && raw !== 'Practitioner' && raw !== 'Organization') {
    throw new Error(`--type debe ser Practitioner u Organization (recibí "${raw}")`);
  }
  return (raw as SupportedType) ?? 'Practitioner';
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }
  const type = parseType();
  const config = CONFIG[type];
  const doDelete = process.argv.includes('--delete-orphans');
  const nameArg = process.argv.find((a) => a.startsWith('--name='))?.slice('--name='.length);

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);
  console.log(`Conectado a ${baseUrl} · tipo=${type}${nameArg ? ` · filtro nombre="${nameArg}"` : ''}\n`);

  const all = (await medplum.searchResources(type, { _count: '1000' })) as Dedupable[];
  const filtered = nameArg ? all.filter((r) => labelOf(r).toLowerCase().includes(nameArg.toLowerCase())) : all;
  console.log(
    `${type} en el proyecto: ${all.length}${nameArg ? ` (coinciden con el filtro: ${filtered.length})` : ''}`
  );

  const groups = new Map<string, Dedupable[]>();
  for (const r of filtered) {
    const key = groupKey(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`Grupos con duplicados: ${dupGroups.length}\n`);

  const toDelete: Dedupable[] = [];

  for (const group of dupGroups) {
    const analyses = await Promise.all(group.map((r) => analyze(medplum, r, config)));
    const keeper = pickKeeper(analyses);
    console.log('─'.repeat(72));
    console.log(`${analyses[0].label}  ·  ${analyses.length} copias`);
    for (const a of analyses) {
      const v = verdict(a);
      const isKeeper = a.resource.id === keeper.resource.id;
      const tag = isKeeper ? '★ CONSERVAR' : v === 'HUÉRFANO' ? '🗑  borrar' : '⚠  reasignar';
      const detail =
        v === 'LOGIN'
          ? `login (${a.memberships} membership)`
          : v === 'REFERENCIADO'
            ? `${a.refs} referencia(s)`
            : 'sin referencias';
      console.log(
        `  ${tag.padEnd(12)} ${a.resource.id}  [${v}] ${detail}` +
          `${a.secondaryId ? ` · ${a.secondaryId}` : ''} · act. ${a.lastUpdated?.slice(0, 10) ?? '—'}`
      );
      if (a.unverified.length > 0) {
        console.log(`               (no verificable: ${a.unverified.join(', ')})`);
      }
      if (!isKeeper && v === 'HUÉRFANO' && a.unverified.length === 0) {
        toDelete.push(a.resource);
      }
    }
    const needReassign = analyses.filter((a) => a.resource.id !== keeper.resource.id && verdict(a) !== 'HUÉRFANO');
    if (needReassign.length > 0) {
      console.log(
        `  → ${needReassign.length} duplicado(s) están EN USO: reasigná sus referencias al ★ (${keeper.resource.id}) antes de borrarlos.`
      );
    }
  }

  console.log('─'.repeat(72));
  console.log(`\nHuérfanos seguros de borrar: ${toDelete.length}`);

  if (!doDelete) {
    console.log('\nDRY-RUN: no se borró nada. Para borrar los huérfanos: agregá  -- --delete-orphans');
    return;
  }
  console.log('\n--delete-orphans: borrando duplicados huérfanos...');
  let ok = 0;
  for (const r of toDelete) {
    try {
      await medplum.deleteResource(type, r.id as string);
      console.log(`  ✓ borrado ${r.id} (${labelOf(r)})`);
      ok++;
    } catch (err) {
      console.log(`  ✗ error borrando ${r.id}: ${(err as Error).message}`);
    }
  }
  console.log(`\nBorrados: ${ok}/${toDelete.length}. Los duplicados EN USO se dejaron intactos (reasignar primero).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

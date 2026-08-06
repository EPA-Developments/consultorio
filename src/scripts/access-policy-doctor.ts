// Diagnóstico de permisos: quién puede ver qué en el proyecto.
//
// Responde la pregunta "¿qué AccessPolicy tiene asignada cada médico?" mirando
// el servidor, no los archivos del repo. Es importante la distinción: una
// AccessPolicy versionada acá NO hace nada hasta que está **asignada** en el
// ProjectMembership de cada usuario. Se puede tener la policy perfecta en el
// repo y los médicos sin acceso, o al revés: policies aplicadas a mano en el
// admin que ningún archivo refleja.
//
// Solo lee. No modifica nada.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run access-policy-doctor
import { MedplumClient } from '@medplum/core';
import type { AccessPolicy, ProjectMembership } from '@medplum/fhirtypes';

/** Nombre para mostrar de un perfil (Practitioner, Patient, ClientApplication…). */
function nombrePerfil(m: ProjectMembership): string {
  return m.profile?.display ?? m.profile?.reference ?? '(sin perfil)';
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
  const proyecto = medplum.getProject();
  console.log(`Proyecto ${proyecto?.id} — ${proyecto?.name ?? '(sin nombre)'}`);
  console.log(`Servidor ${baseUrl}\n`);

  // 1. AccessPolicies que existen en el proyecto.
  const policies = await medplum.searchResources('AccessPolicy', { _count: '100' });
  console.log(`── AccessPolicies en el proyecto: ${policies.length} ──`);
  for (const p of policies) {
    console.log(`  ${p.id}  "${p.name ?? '(sin nombre)'}"  ${p.resource?.length ?? 0} reglas`);
  }

  // 2. Quién es quién: memberships y la policy que tienen asignada.
  const memberships = await medplum.searchResources('ProjectMembership', { _count: '200' });
  const porPolicy = new Map<string, string[]>();

  console.log(`\n── Miembros del proyecto: ${memberships.length} ──`);
  for (const m of memberships) {
    const tipo = m.profile?.reference?.split('/')[0] ?? '?';
    // La policy puede venir directa (accessPolicy) o por rol (access[]).
    const directa = m.accessPolicy?.display ?? m.accessPolicy?.reference;
    const porAcceso = (m.access ?? []).map((a) => a.policy?.display ?? a.policy?.reference).filter(Boolean);
    const asignada = directa ?? (porAcceso.length > 0 ? porAcceso.join(', ') : undefined);
    const admin = m.admin ? '  [ADMIN del proyecto]' : '';

    console.log(`  ${tipo.padEnd(18)} ${nombrePerfil(m)}`);
    console.log(`      AccessPolicy: ${asignada ?? '⚠ NINGUNA'}${admin}`);

    const clave = asignada ?? '(ninguna)';
    porPolicy.set(clave, [...(porPolicy.get(clave) ?? []), nombrePerfil(m)]);
  }

  // 3. Resumen accionable.
  console.log('\n── Resumen: quién tiene cada policy ──');
  for (const [policy, gente] of porPolicy) {
    console.log(`  ${policy}`);
    for (const p of gente) {
      console.log(`      · ${p}`);
    }
  }

  const practitioners = memberships.filter((m) => m.profile?.reference?.startsWith('Practitioner/'));
  const sinPolicy = practitioners.filter((m) => !m.accessPolicy && (m.access ?? []).length === 0 && !m.admin);
  console.log(`\n── Diagnóstico ──`);
  console.log(`Practitioners: ${practitioners.length}`);
  if (sinPolicy.length > 0) {
    console.log(`⚠ ${sinPolicy.length} Practitioner(s) SIN AccessPolicy ni admin:`);
    for (const m of sinPolicy) {
      console.log(`    ${nombrePerfil(m)}`);
    }
    console.log('  Sin policy asignada el usuario puede no ver nada, o —si el servidor');
    console.log('  no restringe por defecto— ver de más. Hay que asignarles una.');
  } else {
    console.log('✓ Todos los Practitioners tienen AccessPolicy asignada o son admin del proyecto.');
  }

  const admins = practitioners.filter((m) => m.admin);
  if (admins.length > 0) {
    console.log(`\nNota: ${admins.length} Practitioner(s) son ADMIN del proyecto.`);
    console.log('  Un admin NO está limitado por la AccessPolicy: ve todo el proyecto.');
    console.log('  Por eso puede parecer que "los permisos funcionan" cuando en realidad');
    console.log('  no se están evaluando. Probar siempre con un usuario NO admin.');
  }
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message ?? err);
  process.exit(1);
});

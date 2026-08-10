// Invita profesionales al proyecto, atados a su Practitioner YA CARGADO.
//
// El invite del admin de Medplum tiene una trampa conocida: crea un
// Practitioner NUEVO Y VACÍO para el usuario invitado. El médico entra,
// intenta emitir, y el sistema le dice "sin matrícula cargada" — porque su
// login apunta al recurso vacío y no al que tiene la matrícula verificada en
// REFEPS. Este script hace la invitación completa y verificada:
//
//   1. Invita por email (el servidor manda el link para crear contraseña).
//   2. Re-apunta la ProjectMembership al Practitioner existente.
//   3. Asigna la AccessPolicy de clínicos.
//   4. Borra el Practitioner vacío que creó el invite (si creó uno).
//   5. Relee y muestra el estado final, para no confiar en el happy path.
//
// Uso:
//   npm run invite-practitioners
//     -> estado: cada Practitioner con matrícula, y si ya tiene acceso.
//   npm run invite-practitioners -- --invite <practitionerId> --email dr@dominio
//     -> invita atando ese email a ese Practitioner.
//   Opcional: --policy "Nombre de la AccessPolicy" (default: la de clínicos
//   versionada en data/ckm/clinician-access-policy.json).
//
// Requiere MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET (admin de proyecto).
import { MedplumClient } from '@medplum/core';
import type { AccessPolicy, Practitioner, ProjectMembership } from '@medplum/fhirtypes';
import fs from 'fs';
import { matriculaOf } from '../laborders/practitioner-validation';

const POLICY_FILE = 'data/ckm/clinician-access-policy.json';

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
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
  const projectId = medplum.getProject()?.id;
  if (!projectId) {
    throw new Error('No se pudo determinar el proyecto del ClientApplication.');
  }
  console.log(`Proyecto ${projectId} en ${baseUrl}\n`);

  const practitionerId = argValue('--invite');
  const email = argValue('--email');
  if (practitionerId && !email) {
    throw new Error('--invite requiere --email: la invitación viaja por correo.');
  }

  if (!practitionerId) {
    await estado(medplum);
    return;
  }
  await invitar(medplum, projectId, practitionerId, email as string);
}

/** Membership cuyo profile apunta a este Practitioner, si existe. */
async function membershipDe(medplum: MedplumClient, practitionerId: string): Promise<ProjectMembership | undefined> {
  return medplum.searchOne('ProjectMembership', `profile=Practitioner/${practitionerId}`);
}

async function estado(medplum: MedplumClient): Promise<void> {
  const practitioners = await medplum.searchResources('Practitioner', { _count: '100' });
  console.log(`Practitioners en el proyecto: ${practitioners.length}\n`);
  for (const p of practitioners) {
    const nombre = p.name?.[0]
      ? `${p.name[0].given?.join(' ') ?? ''} ${p.name[0].family ?? ''}`.trim()
      : '(sin nombre)';
    const matricula = matriculaOf(p);
    const membership = await membershipDe(medplum, p.id as string);
    const acceso = membership
      ? `acceso OK (membership ${membership.id}, policy ${membership.accessPolicy?.reference ?? 'SIN POLICY'})`
      : 'sin acceso todavía';
    console.log(`  ${nombre} (${p.id})`);
    console.log(`    matrícula: ${matricula ?? '(ninguna)'} · ${acceso}`);
    if (!matricula) {
      console.log('    ⚠ sin matrícula: si se lo invita, no va a poder emitir. Cargarla primero.');
    }
  }
  console.log('\nPara invitar: npm run invite-practitioners -- --invite <id> --email <email>');
}

async function invitar(
  medplum: MedplumClient,
  projectId: string,
  practitionerId: string,
  email: string
): Promise<void> {
  // El Practitioner tiene que existir y conviene que tenga matrícula ANTES de
  // invitar: un médico que entra y no puede emitir estrena el sistema con un
  // error.
  const practitioner = await medplum.readResource('Practitioner', practitionerId);
  const nombre = practitioner.name?.[0];
  if (!nombre?.family) {
    throw new Error(`Practitioner/${practitionerId} no tiene apellido cargado; el invite lo necesita.`);
  }
  const matricula = matriculaOf(practitioner);
  console.log(`Invitando a ${nombre.given?.join(' ') ?? ''} ${nombre.family} (${email})`);
  console.log(`  matrícula: ${matricula ?? '(NINGUNA — va a poder entrar pero no emitir)'}`);

  const existente = await membershipDe(medplum, practitionerId);
  if (existente) {
    console.log(`  · Ya tiene membership (${existente.id}); no se invita dos veces.`);
    await asegurarPolicy(medplum, existente);
    return;
  }

  // 1. Invitar. El servidor crea User + ProjectMembership (+ un Practitioner
  // nuevo, que es el que después se re-apunta).
  const inviteUrl = new URL(`admin/projects/${projectId}/invite`, medplum.getBaseUrl());
  const resultado = (await medplum.post(inviteUrl, {
    resourceType: 'Practitioner',
    firstName: nombre.given?.join(' ') || '—',
    lastName: nombre.family,
    email,
    sendEmail: true,
  })) as ProjectMembership;
  console.log(`  ✓ invitación enviada a ${email}`);

  const membershipId = resultado.id;
  if (!membershipId) {
    throw new Error('El invite no devolvió la ProjectMembership; revisar a mano en el admin.');
  }

  // 2. Re-apuntar el profile al Practitioner REAL (el de la matrícula).
  const membership = await medplum.readResource('ProjectMembership', membershipId);
  const perfilCreado = membership.profile?.reference;
  const display = `${nombre.given?.join(' ') ?? ''} ${nombre.family}`.trim();
  const conPerfil = await medplum.updateResource<ProjectMembership>({
    ...membership,
    profile: { reference: `Practitioner/${practitionerId}`, display },
  });
  console.log(`  ✓ membership ${membershipId} apuntada a Practitioner/${practitionerId}`);

  // 3. AccessPolicy de clínicos.
  await asegurarPolicy(medplum, conPerfil);

  // 4. Borrar el Practitioner vacío del invite, si creó uno distinto.
  if (perfilCreado && perfilCreado !== `Practitioner/${practitionerId}`) {
    const vacioId = perfilCreado.split('/')[1];
    try {
      await medplum.deleteResource('Practitioner', vacioId);
      console.log(`  ✓ borrado el Practitioner vacío del invite (${vacioId})`);
    } catch (err) {
      console.log(`  ⚠ no pude borrar el Practitioner vacío ${vacioId}: ${(err as Error).message}`);
    }
  }

  // 5. Releer y mostrar: la verificación es contra el servidor, no contra lo
  // que acabamos de escribir.
  const final = await medplum.readResource('ProjectMembership', membershipId);
  console.log('\n── Estado final ──');
  console.log(`  profile:      ${final.profile?.reference}`);
  console.log(`  accessPolicy: ${final.accessPolicy?.reference ?? 'SIN POLICY ✗'}`);
  console.log(
    final.profile?.reference === `Practitioner/${practitionerId}` && final.accessPolicy
      ? '  ✓ Listo: cuando cree su contraseña, entra como su Practitioner real.'
      : '  ✗ Algo no quedó como se esperaba: revisar en el admin.'
  );
}

/** Asigna la AccessPolicy de clínicos si la membership no tiene ninguna. */
async function asegurarPolicy(medplum: MedplumClient, membership: ProjectMembership): Promise<void> {
  if (membership.accessPolicy) {
    console.log(`  · policy ya asignada: ${membership.accessPolicy.reference}`);
    return;
  }
  const nombrePolicy = argValue('--policy') ?? (JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) as AccessPolicy).name;
  const policy = await medplum.searchOne('AccessPolicy', `name=${encodeURIComponent(nombrePolicy as string)}`);
  if (!policy) {
    console.log(
      `  ⚠ no existe la AccessPolicy "${nombrePolicy}" en el servidor. Subirla: npm run upload-access-policy -- ${POLICY_FILE}`
    );
    return;
  }
  await medplum.updateResource<ProjectMembership>({
    ...membership,
    accessPolicy: { reference: `AccessPolicy/${policy.id}` },
  });
  console.log(`  ✓ policy asignada: ${nombrePolicy}`);
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message ?? err);
  if (String(err).includes('Forbidden')) {
    console.error('  El ClientApplication necesita rol de admin de proyecto para invitar usuarios.');
  }
  process.exit(1);
});

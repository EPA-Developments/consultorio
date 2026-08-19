// Configura el proyecto Medplum para uso en Argentina:
//   1. NamingSystem para DNI, CUIL/CUIT y matrícula profesional (documentan los
//      `system` canónicos que usa el proyecto).
//   2. CodeSystem local de género autopercibido (Ley 26.743, incluye "X").
//   3. StructureDefinition del perfil Patient AR (slices de identificador DNI/
//      CUIL + extensión de identidad de género).
//   4. Paciente de ejemplo con DNI, CUIL, género autopercibido y provincia.
//
// Es idempotente: vuelve a correr sin duplicar (upsert por url/identificador).
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run localize-argentina
import { MedplumClient } from '@medplum/core';
import type { CodeSystem, NamingSystem, Patient, StructureDefinition } from '@medplum/fhirtypes';
import { upsertUnico } from './lib/upsert';
import {
  AR_PROVINCES,
  CUIL_SYSTEM,
  DNI_SYSTEM,
  GENDER_IDENTITY_EXTENSION,
  GENDER_IDENTITY_OPTIONS,
  GENDER_IDENTITY_SYSTEM,
  MATRICULA_SYSTEM,
  PATIENT_AR_PROFILE_URL,
  genderIdentityConcept,
  setGenderIdentity,
  setIdentifierValue,
} from '../ckm/argentina';

const NAMING_SYSTEMS: NamingSystem[] = [
  {
    resourceType: 'NamingSystem',
    name: 'DocumentoNacionalIdentidad',
    status: 'active',
    kind: 'identifier',
    date: '2026-01-01',
    description: 'Documento Nacional de Identidad (DNI) — Argentina',
    uniqueId: [{ type: 'uri', value: DNI_SYSTEM, preferred: true }],
  },
  {
    resourceType: 'NamingSystem',
    name: 'CUILCUIT',
    status: 'active',
    kind: 'identifier',
    date: '2026-01-01',
    description: 'Clave Única de Identificación Laboral/Tributaria (CUIL/CUIT) — AFIP, Argentina',
    uniqueId: [{ type: 'uri', value: CUIL_SYSTEM, preferred: true }],
  },
  {
    resourceType: 'NamingSystem',
    name: 'MatriculaProfesional',
    status: 'active',
    kind: 'identifier',
    date: '2026-01-01',
    description: 'Matrícula profesional (nacional/provincial) — Argentina',
    uniqueId: [{ type: 'uri', value: MATRICULA_SYSTEM, preferred: true }],
  },
];

const GENDER_CODESYSTEM: CodeSystem = {
  resourceType: 'CodeSystem',
  url: GENDER_IDENTITY_SYSTEM,
  name: 'GeneroAutopercibido',
  title: 'Género autopercibido (Ley 26.743)',
  status: 'active',
  content: 'complete',
  concept: GENDER_IDENTITY_OPTIONS.map((o) => ({ code: o.code, display: o.display })),
};

const PATIENT_AR_PROFILE: StructureDefinition = {
  resourceType: 'StructureDefinition',
  url: PATIENT_AR_PROFILE_URL,
  name: 'PatientArgentina',
  title: 'Paciente (Argentina)',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Patient',
  baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
  derivation: 'constraint',
  description:
    'Perfil de Patient para Argentina: identificadores DNI y CUIL/CUIT, e identidad de género autopercibida ' +
    '(Ley 26.743). Reemplaza los conceptos de raza/etnia de US Core, no aplicables en Argentina.',
  differential: {
    element: [
      { id: 'Patient', path: 'Patient' },
      {
        id: 'Patient.identifier',
        path: 'Patient.identifier',
        slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'open' },
        mustSupport: true,
      },
      {
        id: 'Patient.identifier:dni',
        path: 'Patient.identifier',
        sliceName: 'dni',
        min: 0,
        max: '1',
        mustSupport: true,
      },
      { id: 'Patient.identifier:dni.system', path: 'Patient.identifier.system', min: 1, fixedUri: DNI_SYSTEM },
      { id: 'Patient.identifier:cuil', path: 'Patient.identifier', sliceName: 'cuil', min: 0, max: '1' },
      { id: 'Patient.identifier:cuil.system', path: 'Patient.identifier.system', min: 1, fixedUri: CUIL_SYSTEM },
      {
        id: 'Patient.extension:generoAutopercibido',
        path: 'Patient.extension',
        sliceName: 'generoAutopercibido',
        min: 0,
        max: '1',
        type: [{ code: 'Extension', profile: [GENDER_IDENTITY_EXTENSION] }],
        mustSupport: true,
      },
    ],
  },
};

/** Upsert de NamingSystem por el valor de su uniqueId (no hay search por url). */
async function upsertNamingSystem(medplum: MedplumClient, ns: NamingSystem): Promise<void> {
  const value = ns.uniqueId[0]?.value;
  const all = await medplum.searchResources('NamingSystem', { _count: '1000' });
  const existing = all.find((n) => n.uniqueId?.some((u) => u.value === value));
  if (existing) {
    await medplum.updateResource({ ...ns, id: existing.id });
  } else {
    await medplum.createResource(ns);
  }
  console.log(`  OK: NamingSystem ${ns.name} (${value})`);
}

function buildExamplePatient(): Patient {
  const base: Patient = {
    resourceType: 'Patient',
    meta: { profile: [PATIENT_AR_PROFILE_URL] },
    name: [{ given: ['Mariana'], family: 'Gómez' }],
    gender: 'female',
    birthDate: '1972-04-18',
    address: [{ city: 'Rosario', state: 'Santa Fe', country: 'AR' }],
  };
  base.identifier = setIdentifierValue(base, DNI_SYSTEM, '24987654', 'DNI');
  base.identifier = setIdentifierValue(base, CUIL_SYSTEM, '27-24987654-3', 'CUIL');
  base.extension = setGenderIdentity(base, 'femenino');
  return base;
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
  console.log(`Proyecto del client: ${medplum.getProject()?.id}\n`);

  console.log('1. NamingSystems (DNI, CUIL, matrícula)...');
  for (const ns of NAMING_SYSTEMS) {
    await upsertNamingSystem(medplum, ns);
  }

  console.log('\n2. CodeSystem de género autopercibido...');
  const cs = await upsertUnico(medplum, GENDER_CODESYSTEM, `url=${encodeURIComponent(GENDER_IDENTITY_SYSTEM)}`);
  console.log(`  OK: CodeSystem/${cs.id} (${GENDER_IDENTITY_OPTIONS.length} opciones)`);

  console.log('\n3. StructureDefinition perfil Patient AR...');
  const sd = await upsertUnico(medplum, PATIENT_AR_PROFILE, `url=${encodeURIComponent(PATIENT_AR_PROFILE_URL)}`);
  console.log(`  OK: StructureDefinition/${sd.id} (${PATIENT_AR_PROFILE_URL})`);

  console.log('\n4. Paciente de ejemplo...');
  const patient = buildExamplePatient();
  const dni = patient.identifier?.find((id) => id.system === DNI_SYSTEM)?.value;
  const result = await upsertUnico(medplum, patient, `identifier=${encodeURIComponent(`${DNI_SYSTEM}|${dni}`)}`);
  console.log(`  OK: Patient/${result.id} (DNI ${dni}, género autopercibido femenino)`);

  // Prueba de búsqueda por DNI (funciona sin configuración extra).
  const found = await medplum.searchResources('Patient', { identifier: `${DNI_SYSTEM}|${dni}` });
  console.log(`\nTest búsqueda por DNI: ${found.length} paciente(s) con DNI ${dni}`);
  console.log(
    genderIdentityConcept('no-binario') ? '  ✓ Género "X" (no binario) disponible para el DNI argentino.' : ''
  );
  console.log(`\nProvincias cargadas para address.state: ${AR_PROVINCES.length}.`);
  console.log('Listo. Recargá el chart (Ctrl+Shift+R) para ver el panel "Datos Argentina".');
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message ?? err);
  process.exit(1);
});

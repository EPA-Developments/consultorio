// Sube (upsert por nombre) un AccessPolicy versionado al servidor Medplum.
//
// Las políticas viven en data/ckm/:
// - patient-access-policy.json (default): rol paciente (Control). Asignarla
//   como Project.defaultPatientAccessPolicy para el registro automático.
// - clinician-access-policy.json: rol profesional (seguimiento). Asignarla en
//   la ProjectMembership de cada Practitioner.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run upload-access-policy
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx \
//     npm run upload-access-policy -- data/ckm/clinician-access-policy.json
import { MedplumClient } from '@medplum/core';
import type { AccessPolicy } from '@medplum/fhirtypes';
import fs from 'fs';
import { upsertUnico } from './lib/upsert';

const DEFAULT_POLICY_FILE = 'data/ckm/patient-access-policy.json';

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET (ClientApplication del proyecto en ' + baseUrl + ')'
    );
  }

  const policyFile = process.argv[2] ?? DEFAULT_POLICY_FILE;
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8')) as AccessPolicy;
  if (!policy.name) {
    throw new Error(`${policyFile} no tiene name; se necesita para el upsert`);
  }

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);

  const result = await upsertUnico(medplum, policy, `name=${encodeURIComponent(policy.name)}`);
  console.log(`OK: AccessPolicy/${result.id} ("${policy.name}")`);
  console.log(
    'Recordá asignarla: pacientes → Project.defaultPatientAccessPolicy; ' +
      'profesionales → ProjectMembership de cada Practitioner.'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Sube (upsert por URL canónica) el cuestionario SDOH al servidor Medplum.
// El cuestionario vive versionado en data/ckm/sdoh-questionnaire.json.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run upload-sdoh
import { MedplumClient } from '@medplum/core';
import type { Questionnaire } from '@medplum/fhirtypes';
import fs from 'fs';
import { upsertUnico } from './lib/upsert';

const QUESTIONNAIRE_FILE = 'data/ckm/sdoh-questionnaire.json';

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET (ClientApplication del proyecto en ' + baseUrl + ')'
    );
  }

  const questionnaire = JSON.parse(fs.readFileSync(QUESTIONNAIRE_FILE, 'utf8')) as Questionnaire;
  if (!questionnaire.url) {
    throw new Error(`${QUESTIONNAIRE_FILE} no tiene url canónica; se necesita para el upsert`);
  }

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);

  const result = await upsertUnico(medplum, questionnaire, `url=${encodeURIComponent(questionnaire.url)}`);
  console.log(`OK: Questionnaire/${result.id} ("${questionnaire.title}")`);
  console.log(`Formulario disponible en /ckm/sdoh/<patientId> de la app.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ContentType } from '@medplum/core';
import type { Bundle, BundleEntry } from '@medplum/fhirtypes';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { SDOH_QUESTIONNAIRE_URL } from '../ckm/constants';
import { CKM_OBSERVATION_CODES } from '../ckm/observations';

interface BotDescription {
  src: string;
  dist: string;
  criteria?: string;
  /** 'vmcontext' para servidores self-hosted sin AWS Lambda. */
  runtimeVersion?: 'awslambda' | 'vmcontext';
}

// Runtime de los bots CKM. Por defecto awslambda; con CKM_BOT_RUNTIME=vmcontext
// se ejecutan dentro del proceso Medplum (requiere vmContextBotsEnabled:true en
// el servidor), útil cuando crear Lambdas nuevos da "Bots not enabled".
const CKM_RUNTIME = (process.env.CKM_BOT_RUNTIME as 'awslambda' | 'vmcontext') || 'awslambda';

const Bots: BotDescription[] = [
  {
    src: 'src/bots/core/general-encounter-note.ts',
    dist: 'dist/bots/core/general-encounter-note.js',
    criteria: 'QuestionnaireResponse?questionnaire=$encounter-note',
  },
  {
    src: 'src/bots/core/obstetric-encounter-note.ts',
    dist: 'dist/bots/core/obstetric-encounter-note.js',
    criteria: 'QuestionnaireResponse?questionnaire=$obstetric-visit',
  },
  {
    src: 'src/bots/core/gynecology-encounter-note.ts',
    dist: 'dist/bots/core/gynecology-encounter-note.js',
    criteria: 'QuestionnaireResponse?questionnaire=$gynecology-visit',
  },
  {
    src: 'src/bots/ckm/ckm-recalculate.ts',
    dist: 'dist/bots/ckm/ckm-recalculate.js',
    criteria: `Observation?code=${CKM_OBSERVATION_CODES.join(',')}`,
    runtimeVersion: CKM_RUNTIME,
  },
  {
    src: 'src/bots/ckm/sdoh-response.ts',
    dist: 'dist/bots/ckm/sdoh-response.js',
    criteria: `QuestionnaireResponse?questionnaire=${SDOH_QUESTIONNAIRE_URL}`,
    runtimeVersion: CKM_RUNTIME,
  },
  {
    // Disparo MANUAL (medplum.executeBot desde el chart): sin criteria, no crea Subscription.
    src: 'src/bots/ckm/careplan-generate.ts',
    dist: 'dist/bots/ckm/careplan-generate.js',
    runtimeVersion: CKM_RUNTIME,
  },
];

async function main(): Promise<void> {
  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: Bots.flatMap((botDescription): BundleEntry[] => {
      const botName = path.parse(botDescription.src).name;
      const botUrlPlaceholder = `$bot-${botName}-reference`;
      const botIdPlaceholder = `$bot-${botName}-id`;
      const results: BundleEntry[] = [];
      const { srcEntry, distEntry } = readBotFiles(botDescription);
      results.push(srcEntry, distEntry);

      results.push({
        request: { method: 'PUT', url: botUrlPlaceholder },
        resource: {
          resourceType: 'Bot',
          id: botIdPlaceholder,
          name: botName,
          runtimeVersion: botDescription.runtimeVersion ?? 'awslambda',
          sourceCode: {
            // text/typescript no está en la ValueSet IANA de mimetypes que
            // valida el servidor self-hosted; el fuente se guarda como
            // text/plain (es solo para visualización; ejecuta el JavaScript).
            contentType: ContentType.TEXT,
            url: srcEntry.fullUrl,
          },
          executableCode: {
            contentType: ContentType.JAVASCRIPT,
            url: distEntry.fullUrl,
          },
        },
      });

      if (botDescription.criteria) {
        results.push({
          request: {
            url: 'Subscription',
            method: 'POST',
            ifNoneExist: `url=${botUrlPlaceholder}`,
          },
          resource: {
            resourceType: 'Subscription',
            status: 'active',
            reason: botName,
            channel: { endpoint: botUrlPlaceholder, type: 'rest-hook' },
            criteria: botDescription.criteria,
          },
        });
      }

      return results;
    }),
  };

  fs.writeFileSync('data/core/example-bots.json', JSON.stringify(bundle, null, 2));
}

function readBotFiles(description: BotDescription): Record<string, BundleEntry> {
  const sourceFile = fs.readFileSync(description.src);
  const distFile = fs.readFileSync(description.dist);

  const srcEntry: BundleEntry = {
    fullUrl: 'urn:uuid:' + randomUUID(),
    request: { method: 'POST', url: 'Binary' },
    resource: {
      resourceType: 'Binary',
      // text/plain en vez de text/typescript: este último no pasa la
      // validación de mimetypes del servidor self-hosted.
      contentType: ContentType.TEXT,
      data: sourceFile.toString('base64'),
    },
  };
  const distEntry: BundleEntry = {
    fullUrl: 'urn:uuid:' + randomUUID(),
    request: { method: 'POST', url: 'Binary' },
    resource: {
      resourceType: 'Binary',
      contentType: ContentType.JAVASCRIPT,
      data: distFile.toString('base64'),
    },
  };

  return { srcEntry, distEntry };
}

main().catch(console.error);

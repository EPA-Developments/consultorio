// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ContentType } from '@medplum/core';
import type { Bundle, BundleEntry } from '@medplum/fhirtypes';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { identidadDeBot } from '../bot-names';
import { SDOH_QUESTIONNAIRE_URL } from '../ckm/constants';
import { CKM_OBSERVATION_CODES } from '../ckm/observations';

interface BotDescription {
  src: string;
  dist: string;
  criteria?: string;
  /** 'vmcontext' para servidores self-hosted sin AWS Lambda. */
  runtimeVersion?: 'awslambda' | 'vmcontext';
  /**
   * Tiempo máximo de ejecución EN SEGUNDOS (Bot.timeout). El default del
   * runtime es 10 s, que alcanza para los bots de cálculo pero NO para los que
   * llaman a una API externa: el Lambda muere con "Sandbox.Timedout" antes de
   * que la llamada vuelva. Se declara acá para que quede versionado y se
   * aplique en cada despliegue, en vez de tocarlo a mano en la consola.
   */
  timeout?: number;
}

// Runtime de los bots CKM. Por defecto awslambda; con CKM_BOT_RUNTIME=vmcontext
// se ejecutan dentro del proceso Medplum (requiere vmContextBotsEnabled:true en
// el servidor), útil cuando crear Lambdas nuevos da "Bots not enabled".
const CKM_RUNTIME = (process.env.CKM_BOT_RUNTIME as 'awslambda' | 'vmcontext') || 'awslambda';

// Los tres bots de nota del template (general/obstetric/gynecology-encounter-
// note) se eliminaron: la nota de evolución escribe sus recursos directamente
// desde el cliente (src/encounters/nota-evolucion.ts), con los códigos LOINC
// canónicos que ckm-recalculate ya escucha. Si el servidor conserva esos Bots y
// sus Subscriptions de despliegues anteriores, borrarlos desde el admin: sus
// criteria apuntan a cuestionarios que ya no existen y no van a disparar nunca.
const Bots: BotDescription[] = [
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
    // Alertas "3 strikes". Bot PROPIO, aislado del recálculo a propósito: si
    // falla, el estadío y los scores se siguen calculando. Escucha los mismos
    // códigos que ckm-recalculate (dos Subscriptions sobre el mismo criteria).
    src: 'src/bots/ckm/ckm-alerts.ts',
    dist: 'dist/bots/ckm/ckm-alerts.js',
    criteria: `Observation?code=${CKM_OBSERVATION_CODES.join(',')}`,
    runtimeVersion: CKM_RUNTIME,
  },
  {
    // Disparo MANUAL (medplum.executeBot desde el chart): sin criteria, no crea Subscription.
    src: 'src/bots/ckm/careplan-generate.ts',
    dist: 'dist/bots/ckm/careplan-generate.js',
    runtimeVersion: CKM_RUNTIME,
    // Llama a la API de Anthropic para redactar el plan: el bot se da 55 s de
    // margen internamente, así que el runtime necesita MÁS que eso o lo mata
    // antes ("Sandbox.Timedout: Task timed out after 10.00 seconds").
    timeout: 90,
  },
  {
    // Disparo MANUAL (medplum.executeBot antes de emitir una orden): sin
    // criteria, no crea Subscription. Necesita los secrets REFEPS_DOMAIN_SECRET,
    // REFEPS_DOMAIN_URL y, opcionalmente, REFEPS_ENV.
    src: 'src/bots/refeps/refeps-verify.ts',
    dist: 'dist/bots/refeps/refeps-verify.js',
    runtimeVersion: CKM_RUNTIME,
    // Dos saltos de red contra el Bus (token + consulta). Los 10 s por defecto
    // alcanzan justo, y un pico de latencia del Bus daría Sandbox.Timedout.
    timeout: 30,
  },
];

/** Artefacto de build que consume `npm run deploy-bots-server`. */
export const BUNDLE_FILE = 'data/core/example-bots.json';

async function main(): Promise<void> {
  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: Bots.flatMap((botDescription): BundleEntry[] => {
      // El nombre NO sale del nombre del archivo: sale de la tabla de
      // src/bot-names.ts, que le antepone el prefijo del proyecto. Sin
      // prefijo, `Bot?name=ckm-recalculate` lanzado desde Favaloro puede
      // resolver al bot de Biowellness (los proyectos linkeados se ven entre
      // sí por búsqueda).
      const botName = identidadDeBot(botDescription.src).nombre;
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
          ...(botDescription.timeout ? { timeout: botDescription.timeout } : {}),
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

  // El directorio se crea acá y no se versiona: `data/core/example-bots.json`
  // está en .gitignore (es un artefacto de build, no una fuente), y git no
  // versiona directorios vacíos. O sea que en un clone NUEVO `data/core/` no
  // existe y este write fallaba con ENOENT: el pipeline de bots no arrancaba
  // en una máquina donde el repo no se hubiera construido antes.
  fs.mkdirSync(path.dirname(BUNDLE_FILE), { recursive: true });
  fs.writeFileSync(BUNDLE_FILE, JSON.stringify(bundle, null, 2));
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

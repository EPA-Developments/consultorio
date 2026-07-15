// Bot CRON: recalcula el CKM de todos los pacientes periódicamente. Es la red de
// seguridad para cuando la ENTREGA automática de las Subscriptions no dispara
// (el worker async de subscriptions del Medplum self-hosted no procesa el job).
//
// No usa Subscription: se programa con cronString en el recurso Bot (requiere la
// feature 'cron' del proyecto). Reutiliza recomputeCKM — la misma lógica que el
// bot disparado por Observation — pero SIN generar alertas (para no spamear al
// equipo en cada corrida).
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { recomputeCKM } from './ckm-recalculate';

export async function handler(medplum: MedplumClient, _event: BotEvent): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  for await (const page of medplum.searchResourcePages('Patient', { _count: '100' })) {
    for (const patient of page as Patient[]) {
      try {
        await recomputeCKM(medplum, patient);
        processed += 1;
      } catch (err) {
        errors += 1;
        console.error(`ckm-reprocess-cron: error en Patient/${patient.id}`, err);
      }
    }
  }

  console.log(`ckm-reprocess-cron: ${processed} pacientes procesados, ${errors} errores`);
  return { processed, errors };
}

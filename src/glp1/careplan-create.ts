// Escritura del plan GLP-1 contra el servidor.
//
// Va todo en una transacción: o queda el plan con sus controles, o no queda
// nada. Un CarePlan sin sus Task sería un plan que nadie va a ver aparecer en
// el tablero, y Tasks sin plan serían controles huérfanos.
import type { MedplumClient } from '@medplum/core';
import type { Bundle, CarePlan, Task } from '@medplum/fhirtypes';
import { buildGLP1Plan } from './careplan';
import type { GLP1Protocol } from './protocol';

export interface CreatedGLP1Plan {
  carePlan: CarePlan;
  tasks: Task[];
}

/**
 * Crea el CarePlan y sus Task. El plan se referencia con un urn:uuid dentro de
 * la misma transacción, así las Task quedan atadas sin necesitar dos viajes.
 */
export async function createGLP1Plan(
  medplum: MedplumClient,
  params: { protocol: GLP1Protocol; patientId: string; startIso?: string }
): Promise<CreatedGLP1Plan> {
  const startIso = params.startIso ?? new Date().toISOString();
  const carePlanUrn = `urn:uuid:${crypto.randomUUID()}`;
  const { carePlan, tasks } = buildGLP1Plan(params.protocol, params.patientId, startIso, carePlanUrn);

  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      { fullUrl: carePlanUrn, request: { method: 'POST', url: 'CarePlan' }, resource: carePlan },
      ...tasks.map((resource) => ({ request: { method: 'POST' as const, url: 'Task' }, resource })),
    ],
  };

  const result = await medplum.executeBatch(bundle);
  const creados = (result.entry ?? []).map((e) => e.resource);

  return {
    carePlan: (creados.find((r) => r?.resourceType === 'CarePlan') as CarePlan) ?? carePlan,
    tasks: creados.filter((r): r is Task => r?.resourceType === 'Task'),
  };
}

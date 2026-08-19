// Siembra Observations de demostración de los biomarcadores del panel para
// poblar el panel /ckm/biomarkers de un paciente. Para cada biomarcador del
// bundle genera una serie temporal (5 puntos a lo largo de ~7 meses) que termina
// en una banda óptimo / normal / fuera de rango (mezcla determinística por
// paciente+biomarcador), respetando el género — así las sparklines de tendencia
// muestran movimiento y el último valor coincide con el del panel.
//
// Idempotente: una Observation por (paciente, biomarcador, punto), upsert por
// identifier, así re-correrlo actualiza sin duplicar.
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run seed-biomarkers-demo
//     (sin args: pacientes demo marcados con estadío)
//   ... npm run seed-biomarkers-demo -- --all          (todos los pacientes)
//   ... npm run seed-biomarkers-demo -- <patientId>    (un paciente puntual)
import { MedplumClient } from '@medplum/core';
import type { Bundle, Observation, ObservationDefinition, Patient } from '@medplum/fhirtypes';
import biomarkerBundle from '../../data/ckm/biomarker-definitions.json';
import { seedSeries } from '../ckm/biomarker-seed';
import { ageFromBirthDate } from '../ckm/clinical';
import { parseObservationDefinition } from '../ckm/observation-definitions';
import type { BiomarkerDefinition } from '../ckm/observation-definitions';

const SEED_IDENTIFIER_SYSTEM = 'https://seguimiento.medplum.com.ar/seed-patient';
const UCUM = 'http://unitsofmeasure.org';
const DAY_MS = 86_400_000;
// Puntos de la serie temporal por biomarcador (para las sparklines de tendencia).
const SERIES_POINTS = 5;
const SERIES_STEP_DAYS = 35;

interface BiomarkerSpec {
  def: BiomarkerDefinition;
  ucum?: string;
}

function loadSpecs(): BiomarkerSpec[] {
  return ((biomarkerBundle as unknown as Bundle).entry ?? [])
    .map((e) => e.resource as ObservationDefinition)
    .filter((r) => r?.resourceType === 'ObservationDefinition')
    .map((od) => ({ def: parseObservationDefinition(od), ucum: od.quantitativeDetails?.unit?.coding?.[0]?.code }));
}

function isDemoPatient(patient: Patient): boolean {
  const identifier = patient.identifier?.find((i) => i.system === SEED_IDENTIFIER_SYSTEM)?.value;
  if (identifier && /stage[0-4]/i.test(identifier)) {
    return true;
  }
  const name = [patient.name?.[0]?.given?.join(' '), patient.name?.[0]?.family].filter(Boolean).join(' ');
  return /estad[íi]o\s*[0-4]/i.test(name) || /estad[íi]o\s*[0-4]/i.test(patient.name?.[0]?.text ?? '');
}

function buildObservation(
  patientId: string,
  spec: BiomarkerSpec,
  value: number,
  effectiveDateTime: string,
  identifierValue: string
): Observation {
  const { def, ucum } = spec;
  return {
    resourceType: 'Observation',
    status: 'final',
    identifier: [{ system: SEED_IDENTIFIER_SYSTEM, value: identifierValue }],
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'laboratory',
            display: 'Laboratory',
          },
        ],
      },
    ],
    code: {
      coding: def.code ? [{ system: def.system, code: def.code, display: def.label }] : undefined,
      text: def.label,
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime,
    valueQuantity: { value, unit: def.unit, system: UCUM, code: ucum },
  };
}

async function seedPatient(medplum: MedplumClient, patient: Patient, specs: BiomarkerSpec[]): Promise<number> {
  const patientId = patient.id as string;
  const edad = ageFromBirthDate(patient.birthDate);
  const ageYears = Number.isFinite(edad) ? edad : undefined;
  const now = Date.now();
  let written = 0;
  for (const spec of specs) {
    const biomarcadorId = spec.def.biomarcadorId;
    if (!biomarcadorId) {
      continue;
    }
    const series = seedSeries(spec.def, patient.gender, `${patientId}|${biomarcadorId}`, SERIES_POINTS, ageYears);
    if (!series) {
      continue;
    }
    for (let k = 0; k < series.length; k++) {
      const daysAgo = (series.length - 1 - k) * SERIES_STEP_DAYS;
      const effectiveDateTime = new Date(now - daysAgo * DAY_MS).toISOString();
      const identifierValue = `biomarker-${patientId}-${biomarcadorId}-${k}`;
      const obs = buildObservation(patientId, spec, series[k], effectiveDateTime, identifierValue);
      await medplum.upsertResource(obs, `identifier=${SEED_IDENTIFIER_SYSTEM}|${identifierValue}`);
      written++;
    }
  }
  return written;
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET');
  }

  const args = process.argv.slice(2);
  const seedAll = args.includes('--all');
  const explicitId = args.find((a) => !a.startsWith('--'));

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);

  const specs = loadSpecs();
  console.log(`${specs.length} biomarcadores en el bundle. Conectado a ${baseUrl} (proyecto ${medplum.getProject()?.id}).`);

  let patients: Patient[];
  if (explicitId) {
    patients = [await medplum.readResource('Patient', explicitId)];
  } else {
    patients = [];
    for await (const page of medplum.searchResourcePages('Patient', { _count: '100' })) {
      patients.push(...page);
    }
    if (!seedAll) {
      patients = patients.filter(isDemoPatient);
    }
  }

  if (patients.length === 0) {
    console.log('No hay pacientes objetivo. Usá --all o pasá un patientId, o marcá pacientes demo con estadío.');
    return;
  }

  let totalObs = 0;
  for (const patient of patients) {
    const name = patient.name?.[0]
      ? `${patient.name[0].given?.join(' ') ?? ''} ${patient.name[0].family ?? ''}`.trim()
      : patient.id;
    try {
      const n = await seedPatient(medplum, patient, specs);
      totalObs += n;
      console.log(`✓ ${name}: ${n} Observations de biomarcadores`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Forbidden')) {
        throw new Error(
          'Acceso denegado al escribir Observation. El AccessPolicy del ClientApplication tiene que incluir Observation.'
        );
      }
      throw err;
    }
  }
  console.log(`\nSeed de biomarcadores completo: ${totalObs} Observations en ${patients.length} paciente(s).`);
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message ?? err);
  process.exit(1);
});

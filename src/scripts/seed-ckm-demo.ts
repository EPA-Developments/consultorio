// Estampa datos CKM de demostración en los pacientes seed del proyecto.
//
// Para cada Patient cuyo identifier o nombre indique un estadío demo
// (identifier "ckm-seed-stageN" o nombre "... Estadío N"):
// - escribe las extensiones CKMStage y hGraphData (métricas + scores PREVENT
//   coherentes con el estadío)
// - crea/actualiza un RiskAssessment con las predicciones PREVENT
// - para estadíos 3-4, crea una Communication de categoría 'alert' sin leer
//
// Uso:
//   MEDPLUM_CLIENT_ID=xxx MEDPLUM_CLIENT_SECRET=xxx npm run seed-ckm-demo
import { MedplumClient } from '@medplum/core';
import type { Communication, Extension, Patient, RiskAssessment } from '@medplum/fhirtypes';
import { CKM_STAGE_URL, HGRAPH_DATA_URL } from '../ckm/constants';
import type { CKMParameterId } from '../ckm/constants';
import type { CKMStage, HGraphMetric, HGraphMetricStatus, PREVENTScores } from '../ckm/types';
import { upsertUnico } from './lib/upsert';

const SEED_IDENTIFIER_SYSTEM = 'https://seguimiento.medplum.com.ar/seed-patient';

// Endpoints saludable (estadío 0) y enfermo (estadío 4) de cada métrica
interface MetricSpec {
  id: CKMParameterId;
  label: string;
  unit: string;
  healthy: number;
  sick: number;
  decimals?: number;
}

const METRIC_SPECS: MetricSpec[] = [
  { id: 'sbp', label: 'PA sistólica', unit: 'mmHg', healthy: 112, sick: 162 },
  { id: 'dbp', label: 'PA diastólica', unit: 'mmHg', healthy: 72, sick: 98 },
  { id: 'bmi', label: 'IMC', unit: 'kg/m²', healthy: 23, sick: 36, decimals: 1 },
  { id: 'waist', label: 'Cintura', unit: 'cm', healthy: 80, sick: 115 },
  { id: 'glucoseFasting', label: 'Glucemia ayunas', unit: 'mg/dL', healthy: 88, sick: 142 },
  { id: 'hba1c', label: 'HbA1c', unit: '%', healthy: 5.2, sick: 8.1, decimals: 1 },
  { id: 'ldlc', label: 'LDL-C', unit: 'mg/dL', healthy: 90, sick: 168 },
  { id: 'hdlc', label: 'HDL-C', unit: 'mg/dL', healthy: 58, sick: 34 },
  { id: 'triglycerides', label: 'Triglicéridos', unit: 'mg/dL', healthy: 95, sick: 260 },
  { id: 'egfr', label: 'TFGe', unit: 'mL/min/1.73m²', healthy: 98, sick: 44 },
];

// Variación por métrica para que el polígono del hGraph no sea regular
const SCORE_JITTER = [0.02, -0.04, 0.05, -0.02, 0.03, -0.05, 0.04, -0.03, 0.01, -0.06];

const PREVENT_BY_STAGE: Record<CKMStage, PREVENTScores> = {
  0: { ascvd10y: 2.1, hf10y: 1.2, cvdTotal30y: 8.5 },
  1: { ascvd10y: 5.4, hf10y: 3.1, cvdTotal30y: 15.2 },
  2: { ascvd10y: 10.8, hf10y: 6.9, cvdTotal30y: 27.6 },
  3: { ascvd10y: 18.2, hf10y: 12.4, cvdTotal30y: 41.9 },
  4: { ascvd10y: 28.7, hf10y: 21.5, cvdTotal30y: 59.3 },
};

function statusForScore(score: number): HGraphMetricStatus {
  if (score >= 0.75) {
    return 'healthy';
  }
  return score >= 0.4 ? 'moderate' : 'high';
}

function buildMetrics(stage: CKMStage): HGraphMetric[] {
  const severity = stage / 4;
  return METRIC_SPECS.map((spec, i) => {
    const value = spec.healthy + (spec.sick - spec.healthy) * severity;
    const score = Math.min(1, Math.max(0.05, 1 - 0.85 * severity + SCORE_JITTER[i]));
    const factor = 10 ** (spec.decimals ?? 0);
    return {
      id: spec.id,
      label: spec.label,
      value: Math.round(value * factor) / factor,
      unit: spec.unit,
      score: Math.round(score * 100) / 100,
      status: statusForScore(score),
    };
  });
}

function detectStage(patient: Patient): CKMStage | undefined {
  const identifier = patient.identifier?.find((i) => i.system === SEED_IDENTIFIER_SYSTEM)?.value;
  const fromIdentifier = identifier?.match(/stage([0-4])/i)?.[1];
  const name = patient.name?.[0]?.text ?? [patient.name?.[0]?.given?.join(' '), patient.name?.[0]?.family].join(' ');
  const fromName = name?.match(/estad[íi]o\s*([0-4])/i)?.[1];
  const raw = fromIdentifier ?? fromName;
  return raw !== undefined ? (Number(raw) as CKMStage) : undefined;
}

/** Estadío demo determinístico (0-4) para pacientes sin marcador (modo --all). */
function deterministicStage(id: string | undefined): CKMStage {
  let hash = 0;
  for (const char of id ?? '') {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return (hash % 5) as CKMStage;
}

async function main(): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com.ar';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Faltan MEDPLUM_CLIENT_ID y MEDPLUM_CLIENT_SECRET (ClientApplication del proyecto en ' + baseUrl + ')'
    );
  }

  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(clientId, clientSecret);

  // Con --all, los pacientes sin marcador reciben un estadío demo
  // determinístico en lugar de saltearse
  const seedAll = process.argv.includes('--all');

  const patients = await medplum.searchResources('Patient', { _count: '100' });
  for (const patient of patients) {
    let stage = detectStage(patient);
    const name = patient.name?.[0] ? `${patient.name[0].given?.join(' ')} ${patient.name[0].family ?? ''}` : patient.id;
    if (stage === undefined && seedAll) {
      stage = deterministicStage(patient.id);
      console.log(`  (${name}: sin marcador, --all le asigna estadío demo ${stage})`);
    }
    if (stage === undefined) {
      console.log(`- ${name}: sin marcador de estadío (identifier ckm-seed-stageN o nombre "Estadío N"), salteado`);
      continue;
    }

    const prevent = PREVENT_BY_STAGE[stage];
    const hGraphData = JSON.stringify({ metrics: buildMetrics(stage), prevent });
    const extensions: Extension[] = [
      { url: CKM_STAGE_URL, valueInteger: stage },
      { url: HGRAPH_DATA_URL, valueString: hGraphData },
    ];
    const otherExtensions = (patient.extension ?? []).filter(
      (e) => e.url !== CKM_STAGE_URL && e.url !== HGRAPH_DATA_URL
    );
    await write('Patient', medplum.updateResource({ ...patient, extension: [...otherExtensions, ...extensions] }));

    const riskAssessment: RiskAssessment = {
      resourceType: 'RiskAssessment',
      status: 'final',
      subject: { reference: `Patient/${patient.id}` },
      identifier: [{ system: SEED_IDENTIFIER_SYSTEM, value: `ckm-seed-risk-${patient.id}` }],
      occurrenceDateTime: new Date().toISOString(),
      method: { text: 'Ecuaciones PREVENT (AHA)' },
      prediction: [
        { outcome: { text: 'ASCVD 10 años' }, probabilityDecimal: prevent.ascvd10y },
        { outcome: { text: 'Insuficiencia cardíaca 10 años' }, probabilityDecimal: prevent.hf10y },
        { outcome: { text: 'ECV total 30 años' }, probabilityDecimal: prevent.cvdTotal30y },
      ],
    };
    await write(
      'RiskAssessment',
      upsertUnico(medplum, riskAssessment, `identifier=${SEED_IDENTIFIER_SYSTEM}|ckm-seed-risk-${patient.id}`)
    );

    if (stage >= 3) {
      const alert: Communication = {
        resourceType: 'Communication',
        status: 'in-progress',
        identifier: [{ system: SEED_IDENTIFIER_SYSTEM, value: `ckm-seed-alert-${patient.id}` }],
        category: [
          {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/communication-category', code: 'alert' }],
          },
        ],
        subject: { reference: `Patient/${patient.id}` },
        sent: new Date().toISOString(),
        payload: [
          { contentString: `Riesgo PREVENT-CVD elevado (${prevent.ascvd10y}% a 10 años). Revisar plan terapéutico.` },
        ],
      };
      await write(
        'Communication',
        upsertUnico(medplum, alert, `identifier=${SEED_IDENTIFIER_SYSTEM}|ckm-seed-alert-${patient.id}`)
      );
    }

    console.log(`✓ ${name}: estadío ${stage}, hGraph + PREVENT + RiskAssessment${stage >= 3 ? ' + alerta' : ''}`);
  }
  console.log('Seed CKM completo.');
}

// Traduce el Forbidden de Medplum a un mensaje accionable sobre el AccessPolicy
async function write<T>(resourceType: string, action: Promise<T>): Promise<T> {
  try {
    return await action;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Forbidden')) {
      throw new Error(
        `Acceso denegado al escribir ${resourceType}. El AccessPolicy del ClientApplication tiene que incluir ` +
          'Patient, RiskAssessment y Communication (app de admin → Project → Clients → membership → Access Policy), ' +
          'o bien usar un client sin Access Policy.'
      );
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

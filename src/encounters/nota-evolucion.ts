// La nota de evolución: el cuestionario y los recursos que produce.
//
// POR QUÉ EL CUESTIONARIO VIVE EN EL CÓDIGO Y NO EN EL SERVIDOR
//
// El diseño del template buscaba un Questionnaire en el servidor por código de
// tipo de encuentro. Fallaba por tres motivos independientes: los cuestionarios
// solo llegaban al servidor por una pantalla de seed que no está enlazada en
// ningún flujo; los códigos de tipo que ofrece el formulario no coinciden con
// los useContext de esos cuestionarios; y el cuestionario "general" era la
// consulta de menopausia del template, en inglés. El síntoma era el peor
// posible: spinner infinito en toda la pantalla de la evolución.
//
// Acá el cuestionario es una constante. No hay seed, no hay búsqueda, no hay
// estado del servidor del que depender. Es la misma decisión que
// encounter-coding.ts, por el mismo motivo.
//
// POR QUÉ LOS RECURSOS SE CREAN EN EL CLIENTE Y NO EN UN BOT
//
// El template creaba las Observations en un bot disparado por Subscription:
// cuatro eslabones (cuestionario sembrado + bot desplegado + Subscription viva
// + feature 'bots' del proyecto) donde cada uno falla en silencio. Acá el
// submit escribe los recursos directamente, en una sola transacción. El bot
// ckm-recalculate — ese sí desplegado y con Subscription — se dispara solo,
// porque los signos vitales se escriben con los códigos LOINC canónicos que su
// criteria ya escucha.
//
// LOS CÓDIGOS IMPORTAN MÁS QUE EL FORMULARIO. El bot del template guardaba la
// presión arterial como una Observation 35094-2 que NINGUNA lectura del stack
// CKM incluye: el médico cargaba la presión y PREVENT no la veía. Acá cada
// signo vital usa el código que el resto del sistema ya lee: el panel de PA
// 85354-9 con componentes 8480-6/8462-4 (la forma canónica que espera
// observations.ts), peso 29463-7 (la que lee la respuesta GLP-1), cintura
// 56086-2 e IMC 39156-5 (parámetros CKM). Lo que se carga en la nota entra al
// circuito, no a un cajón.
import { getQuestionnaireAnswers } from '@medplum/core';
import type {
  Bundle,
  BundleEntry,
  ClinicalImpression,
  Encounter,
  Observation,
  Patient,
  Practitioner,
  Questionnaire,
  QuestionnaireResponse,
  Reference,
} from '@medplum/fhirtypes';
import { LOINC, LOINC_BP_PANEL, LOINC_SYSTEM } from '../ckm/constants';

/** Código LOINC del peso corporal: el que lee la respuesta al GLP-1. */
export const LOINC_PESO = '29463-7';
/** Código LOINC de la talla. */
export const LOINC_TALLA = '8302-2';

/**
 * Identifica las respuestas de esta nota. No apunta a un recurso del servidor
 * a propósito: el cuestionario vive en el código.
 */
export const NOTA_EVOLUCION_URL = 'https://biowellness.ar/fhir/Questionnaire/nota-evolucion';

export const NOTA_EVOLUCION: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'active',
  id: 'nota-evolucion',
  name: 'nota-evolucion',
  title: 'Nota de evolución',
  item: [
    {
      linkId: 'motivo',
      type: 'string',
      text: 'Motivo de la consulta',
      required: true,
    },
    {
      linkId: 'evolucion',
      type: 'text',
      text: 'Evolución',
      required: true,
    },
    {
      linkId: 'vitales',
      type: 'group',
      text: 'Signos vitales',
      item: [
        { linkId: 'sistolica', type: 'quantity', text: 'Presión sistólica (mmHg)' },
        { linkId: 'diastolica', type: 'quantity', text: 'Presión diastólica (mmHg)' },
        { linkId: 'peso', type: 'quantity', text: 'Peso (kg)' },
        { linkId: 'talla', type: 'quantity', text: 'Talla (cm)' },
        { linkId: 'cintura', type: 'quantity', text: 'Circunferencia de cintura (cm)' },
      ],
    },
    {
      linkId: 'plan',
      type: 'text',
      text: 'Plan e indicaciones',
    },
  ],
};

/** Unidades por linkId, para que las Observations salgan con UCUM correcto. */
const UNIDADES: Record<string, { unit: string; code: string }> = {
  sistolica: { unit: 'mmHg', code: 'mm[Hg]' },
  diastolica: { unit: 'mmHg', code: 'mm[Hg]' },
  peso: { unit: 'kg', code: 'kg' },
  talla: { unit: 'cm', code: 'cm' },
  cintura: { unit: 'cm', code: 'cm' },
};

function cantidad(valor: number, linkId: string): Observation['valueQuantity'] {
  const u = UNIDADES[linkId];
  return { value: valor, unit: u.unit, system: 'http://unitsofmeasure.org', code: u.code };
}

function observacionBase(
  encuentro: Encounter,
  profesional: Practitioner | undefined,
  fecha: string
): Pick<Observation, 'resourceType' | 'status' | 'subject' | 'encounter' | 'performer' | 'effectiveDateTime'> {
  return {
    resourceType: 'Observation',
    status: 'final',
    subject: encuentro.subject as Reference<Patient>,
    encounter: { reference: `Encounter/${encuentro.id}` },
    performer: profesional ? [{ reference: `Practitioner/${profesional.id}` }] : undefined,
    effectiveDateTime: fecha,
  };
}

/**
 * Construye la transacción completa de una nota: la respuesta al cuestionario
 * más los recursos clínicos que salen de ella.
 *
 * Es UN Bundle de transacción: o entra todo o no entra nada. Una nota a
 * medias — la impresión clínica guardada y los signos vitales no — es peor que
 * un error, porque nadie sabe que falta la otra mitad.
 */
export function recursosDeLaNota(
  respuesta: QuestionnaireResponse,
  encuentro: Encounter,
  profesional: Practitioner | undefined
): Bundle {
  const answers = getQuestionnaireAnswers(respuesta);
  const fecha = encuentro.period?.start ?? new Date().toISOString();
  const base = observacionBase(encuentro, profesional, fecha);

  const recursos: (Observation | ClinicalImpression)[] = [];

  const valor = (linkId: string): number | undefined => answers[linkId]?.valueQuantity?.value;

  // Presión arterial: UNA Observation con el panel 85354-9 y componentes, que
  // es la forma canónica que lee observations.ts y dispara ckm-recalculate.
  const sistolica = valor('sistolica');
  const diastolica = valor('diastolica');
  if (sistolica !== undefined || diastolica !== undefined) {
    recursos.push({
      ...base,
      code: { coding: [{ system: LOINC_SYSTEM, code: LOINC_BP_PANEL, display: 'Blood pressure panel' }] },
      component: [
        ...(sistolica !== undefined
          ? [
              {
                code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.sbp }] },
                valueQuantity: cantidad(sistolica, 'sistolica'),
              },
            ]
          : []),
        ...(diastolica !== undefined
          ? [
              {
                code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.dbp }] },
                valueQuantity: cantidad(diastolica, 'diastolica'),
              },
            ]
          : []),
      ],
    });
  }

  const simples: { linkId: string; code: string }[] = [
    { linkId: 'peso', code: LOINC_PESO },
    { linkId: 'talla', code: LOINC_TALLA },
    { linkId: 'cintura', code: LOINC.waist },
  ];
  for (const { linkId, code } of simples) {
    const v = valor(linkId);
    if (v !== undefined) {
      recursos.push({
        ...base,
        code: { coding: [{ system: LOINC_SYSTEM, code }] },
        valueQuantity: cantidad(v, linkId),
      });
    }
  }

  // IMC derivado de peso y talla. Se persiste porque es parámetro CKM: el
  // estadío y el hGraph lo leen como Observation, no lo recalculan.
  const peso = valor('peso');
  const talla = valor('talla');
  if (peso !== undefined && talla !== undefined && talla > 0) {
    const metros = talla / 100;
    const imc = Math.round((peso / (metros * metros)) * 10) / 10;
    recursos.push({
      ...base,
      code: { coding: [{ system: LOINC_SYSTEM, code: LOINC.bmi }] },
      valueQuantity: { value: imc, unit: 'kg/m2', system: 'http://unitsofmeasure.org', code: 'kg/m2' },
    });
  }

  // La evolución y el plan quedan como ClinicalImpression, que es donde la
  // pantalla de impresiones clínicas del chart ya las busca.
  const evolucion = answers['evolucion']?.valueString;
  const plan = answers['plan']?.valueString;
  const motivo = answers['motivo']?.valueString;
  if (evolucion || plan || motivo) {
    recursos.push({
      resourceType: 'ClinicalImpression',
      status: 'completed',
      subject: encuentro.subject as Reference<Patient>,
      encounter: { reference: `Encounter/${encuentro.id}` },
      date: fecha,
      assessor: profesional ? { reference: `Practitioner/${profesional.id}` } : undefined,
      description: motivo,
      summary: [evolucion, plan ? `Plan: ${plan}` : undefined].filter(Boolean).join('\n\n'),
      note: undefined,
    });
  }

  // La respuesta viaja en la misma transacción, completada con las referencias
  // que el formulario no conoce.
  const respuestaCompleta: QuestionnaireResponse = {
    ...respuesta,
    questionnaire: NOTA_EVOLUCION_URL,
    status: 'completed',
    encounter: { reference: `Encounter/${encuentro.id}` },
    subject: encuentro.subject as Reference<Patient>,
    author: profesional ? { reference: `Practitioner/${profesional.id}` } : undefined,
    authored: new Date().toISOString(),
  };

  const entries: BundleEntry[] = [respuestaCompleta, ...recursos].map((r) => ({
    resource: r,
    request: { method: 'POST', url: r.resourceType },
  }));

  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
}

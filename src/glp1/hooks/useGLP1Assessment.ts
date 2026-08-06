// Arma la evaluación GLP-1 de un paciente con los datos que YA están cargados.
//
// Los insumos vienen de tres lugares distintos y hay que unirlos:
// 1. Mapa CKM (LOINC): IMC, cintura, presión, HbA1c, glucemia, eGFR, UACR.
// 2. Catálogo de biomarcadores (slug): HOMA-IR e insulina basal, que NO son
//    parámetros CKM pero sí están entre los 109 marcadores del panel.
// 3. Conditions y MedicationRequests: antecedentes y medicación.
//
// Solo lee. El cálculo vive en eligibility.ts (puro y testeado).
import type { Condition, MedicationRequest, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import {
  ageFromBirthDate,
  hasDiabetes,
  hasHeartFailure,
  isActiveCondition,
  isClinicalCVD,
  patientPreventSex,
} from '../../ckm/clinical';
import { getCKMStage, getHGraphData } from '../../ckm/extensions';
import { getLatestCKMObservations } from '../../ckm/observations';
import { latestValueByCode } from '../../ckm/observation-definitions';
import { assessGLP1 } from '../eligibility';
import type { GLP1Assessment } from '../eligibility';
import { computeHomaIr, glp1ConditionFlags, glp1MedicationFlags } from '../glp1-clinical';

/** Códigos del catálogo (109 marcadores) que no son parámetros CKM. */
const CODIGO_HOMA_IR = 'homa-ir';
const CODIGO_INSULINA = '20448-7'; // Insulina basal (LOINC)

export interface GLP1AssessmentData {
  assessment?: GLP1Assessment;
  loading: boolean;
}

export function useGLP1Assessment(patient: Patient | undefined): GLP1AssessmentData {
  const medplum = useMedplum();
  const [data, setData] = useState<GLP1AssessmentData>();
  const patientId = patient?.id;

  useEffect(() => {
    if (!patientId || !patient) {
      setData(undefined);
      return;
    }
    let cancelled = false;
    setData({ loading: true });

    void (async () => {
      try {
        const [ckm, conditions, medications, observations] = await Promise.all([
          getLatestCKMObservations(medplum, patientId),
          medplum.searchResources('Condition', { subject: `Patient/${patientId}`, _count: '200' }),
          medplum.searchResources('MedicationRequest', {
            subject: `Patient/${patientId}`,
            status: 'active',
            _count: '100',
          }),
          // HOMA-IR e insulina viven en el catálogo de biomarcadores, no en CKM.
          medplum.searchResources('Observation', {
            subject: `Patient/${patientId}`,
            code: `${CODIGO_HOMA_IR},${CODIGO_INSULINA}`,
            _sort: '-date',
            _count: '50',
          }),
        ]);
        if (cancelled) {
          return;
        }

        const activas = (conditions as Condition[]).filter(isActiveCondition);
        const porCodigo = latestValueByCode(observations);
        const insulina = porCodigo.get(CODIGO_INSULINA)?.value;
        const glucosa = ckm.glucoseFasting?.value;
        const hGraph = getHGraphData(patient);

        const assessment = assessGLP1({
          ageYears: ageFromBirthDate(patient.birthDate) || undefined,
          sex: patientPreventSex(patient),
          bmi: ckm.bmi?.value,
          waistCm: ckm.waist?.value,
          hba1cPercent: ckm.hba1c?.value,
          fastingGlucoseMgDl: glucosa,
          fastingInsulinUUmL: insulina,
          // Se prefiere el HOMA-IR medido; si no está, se deriva.
          homaIr: porCodigo.get(CODIGO_HOMA_IR)?.value ?? computeHomaIr(glucosa, insulina),
          egfr: ckm.egfr?.value,
          uacrMgG: ckm.uacr?.value,
          sbp: ckm.sbp?.value,
          ckmStage: getCKMStage(patient),
          ascvd10y: hGraph.prevent?.ascvd10y,
          hasT2D: hasDiabetes(activas),
          hasASCVD: activas.some(isClinicalCVD),
          hasHeartFailure: hasHeartFailure(activas),
          ...glp1ConditionFlags(activas),
          ...glp1MedicationFlags(medications as MedicationRequest[]),
        });

        setData({ assessment, loading: false });
      } catch (err) {
        console.error('GLP-1: error evaluando elegibilidad', err);
        if (!cancelled) {
          setData({ loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `patient` completo fuera de las dependencias: cambia de identidad en cada
    // render de useResource y dispararía un bucle de fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medplum, patientId]);

  return data ?? { loading: false };
}

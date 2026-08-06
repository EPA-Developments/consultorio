// Datos para el seguimiento longitudinal de la respuesta al GLP-1.
//
// Junta tres cosas: el plan vigente (que aporta el inicio y las fechas de los
// controles), el historial de los parámetros CKM (IMC, cintura, HbA1c) y el
// peso, que no es parámetro CKM y hay que pedir aparte.
//
// Solo lee.
import type { CarePlan, Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import { getCKMObservationHistory } from '../../ckm/observations';
import { activeGLP1Plan, planTimeline } from '../plan-reading';
import type { PlanTimeline } from '../plan-reading';
import { assessResponse } from '../response';
import type { DatedValue, ResponseAssessment, ResponseMetricId } from '../response';

/** Peso corporal. No está entre los parámetros CKM, que arrancan en el IMC. */
const LOINC_PESO = '29463-7';

export interface GLP1ResponseData {
  assessment?: ResponseAssessment;
  timeline?: PlanTimeline;
  /** true si el paciente no tiene ningún plan GLP-1 vigente. */
  sinPlan: boolean;
  loading: boolean;
}

function pesoSeries(observations: Observation[]): DatedValue[] {
  return observations
    .filter((o) => o.status !== 'entered-in-error')
    .map((o) => ({
      date: o.effectiveDateTime ?? '',
      value: o.valueQuantity?.value as number,
      unit: o.valueQuantity?.unit,
    }))
    .filter((p) => p.date && Number.isFinite(p.value));
}

export function useGLP1Response(patient: Patient | undefined): GLP1ResponseData {
  const medplum = useMedplum();
  const [data, setData] = useState<GLP1ResponseData>();
  const patientId = patient?.id;

  useEffect(() => {
    if (!patientId) {
      setData(undefined);
      return;
    }
    let cancelled = false;
    setData({ sinPlan: false, loading: true });

    void (async () => {
      try {
        const planes = (await medplum.searchResources('CarePlan', {
          subject: `Patient/${patientId}`,
          _sort: '-_lastUpdated',
          _count: '50',
        })) as CarePlan[];

        const plan = activeGLP1Plan(planes);
        const timeline = plan ? planTimeline(plan) : undefined;
        if (cancelled) {
          return;
        }
        if (!timeline) {
          setData({ sinPlan: true, loading: false });
          return;
        }

        const [historia, pesos] = await Promise.all([
          getCKMObservationHistory(medplum, patientId),
          medplum.searchResources('Observation', {
            subject: `Patient/${patientId}`,
            code: LOINC_PESO,
            _sort: '-date',
            _count: '200',
          }),
        ]);
        if (cancelled) {
          return;
        }

        const series: Partial<Record<ResponseMetricId, DatedValue[]>> = {
          peso: pesoSeries(pesos),
          imc: (historia.bmi ?? []) as DatedValue[],
          cintura: (historia.waist ?? []) as DatedValue[],
          hba1c: (historia.hba1c ?? []) as DatedValue[],
        };

        setData({
          assessment: assessResponse({
            series,
            planStartIso: timeline.planStartIso,
            reviewWeeks: timeline.reviewWeeks ?? 0,
            nowIso: new Date().toISOString(),
          }),
          timeline,
          sinPlan: false,
          loading: false,
        });
      } catch (err) {
        console.error('GLP-1: error leyendo la respuesta al tratamiento', err);
        if (!cancelled) {
          setData({ sinPlan: false, loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [medplum, patientId]);

  return data ?? { sinPlan: false, loading: false };
}

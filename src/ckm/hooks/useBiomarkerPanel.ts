// Hook del panel de biomarcadores de un paciente: combina las definiciones
// (ObservationDefinitions, agrupadas por panel) con el último valor observado
// de cada biomarcador. No modifica nada; solo lee.
import type { Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum, useResource } from '@medplum/react';
import { useEffect, useMemo, useState } from 'react';
import { ageFromBirthDate } from '../clinical';
import { groupByPanel, latestValueByCode, valuesByCodeHistory } from '../observation-definitions';
import type { BiomarkerPanelGroup, CodedValue } from '../observation-definitions';
import { useObservationDefinitions } from './useObservationDefinitions';

export interface BiomarkerPanelData {
  patient?: Patient;
  groups: BiomarkerPanelGroup[];
  valuesByCode: Map<string, CodedValue>;
  historyByCode: Map<string, CodedValue[]>;
  gender?: string;
  ageYears?: number;
  loading: boolean;
  /** true si falló alguna lectura: "0/N con datos" sería un paciente inventado. */
  error: boolean;
}

const EMPTY_OBSERVATIONS: Observation[] = [];
// Tope de seguridad: cubre con holgura el historial real de un paciente sin
// arriesgar una descarga ilimitada.
const MAX_OBSERVATIONS = 3000;

export function useBiomarkerPanel(patientId: string | undefined): BiomarkerPanelData {
  const medplum = useMedplum();
  const { definitions, loading: defsLoading, error: defsError } = useObservationDefinitions();
  const patient = useResource<Patient>(patientId ? { reference: `Patient/${patientId}` } : undefined);
  const [observations, setObservations] = useState<Observation[]>();
  const [obsError, setObsError] = useState(false);

  const codes = useMemo(
    () => [...new Set(definitions.map((d) => d.code).filter((c): c is string => Boolean(c)))],
    [definitions]
  );

  useEffect(() => {
    if (!patientId || codes.length === 0) {
      setObservations(EMPTY_OBSERVATIONS);
      return;
    }
    let cancelled = false;
    setObsError(false);
    void (async () => {
      try {
        const all: Observation[] = [];
        for await (const page of medplum.searchResourcePages('Observation', {
          subject: `Patient/${patientId}`,
          code: codes.join(','),
          _sort: '-date',
          _count: '500',
        })) {
          if (cancelled) {
            return;
          }
          all.push(...page);
          if (all.length >= MAX_OBSERVATIONS) {
            break;
          }
        }
        if (!cancelled) {
          setObservations(all);
        }
      } catch (err) {
        console.error('Panel de biomarcadores: error buscando Observations', err);
        if (!cancelled) {
          setObsError(true);
          setObservations(EMPTY_OBSERVATIONS);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [medplum, patientId, codes]);

  const groups = useMemo(() => groupByPanel(definitions), [definitions]);
  const valuesByCode = useMemo(() => latestValueByCode(observations ?? EMPTY_OBSERVATIONS), [observations]);
  const historyByCode = useMemo(() => valuesByCodeHistory(observations ?? EMPTY_OBSERVATIONS), [observations]);

  const edad = ageFromBirthDate(patient?.birthDate);

  return {
    patient,
    groups,
    valuesByCode,
    historyByCode,
    gender: patient?.gender,
    // ageFromBirthDate devuelve NaN si no hay fecha de nacimiento; el
    // clasificador espera undefined para "no sé la edad".
    ageYears: Number.isFinite(edad) ? edad : undefined,
    loading: defsLoading || observations === undefined,
    error: defsError || obsError,
  };
}

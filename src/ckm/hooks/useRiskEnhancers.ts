// Hook que trae las Observations de los potenciadores de riesgo (ApoB, Lp(a))
// de un paciente y devuelve la última lectura clasificada de cada uno. Los
// umbrales salen de las ObservationDefinitions cargadas (fuente de verdad FHIR)
// con fallback al hardcode. Etapa 3+5: lectura en vivo desde el servidor, sin
// pasar por el bot ni la extensión hGraphData (no modifica el cálculo PREVENT).
import type { Observation } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useMemo, useState } from 'react';
import { ENHANCER_LOINC_CODES, readEnhancers } from '../biomarkers';
import type { EnhancerReading } from '../biomarkers';
import { useObservationDefinitions } from './useObservationDefinitions';

export interface RiskEnhancersData {
  readings: EnhancerReading[];
  loading: boolean;
  /** true si falló la búsqueda: "ApoB sin dato" sería una afirmación falsa. */
  error: boolean;
}

export function useRiskEnhancers(patientId: string | undefined): RiskEnhancersData {
  const medplum = useMedplum();
  const { byLoinc, loading: defsLoading } = useObservationDefinitions();
  const [observations, setObservations] = useState<Observation[]>();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!patientId) {
      setObservations([]);
      return;
    }
    let cancelled = false;
    setError(false);
    medplum
      .searchResources('Observation', {
        subject: `Patient/${patientId}`,
        code: ENHANCER_LOINC_CODES.join(','),
        _sort: '-date',
        _count: '50',
      })
      .then((result) => {
        if (!cancelled) {
          setObservations(result);
        }
      })
      .catch((err) => {
        console.error('Potenciadores de riesgo: error buscando Observations', err);
        if (!cancelled) {
          setError(true);
          setObservations([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [medplum, patientId]);

  const readings = useMemo(() => readEnhancers(observations ?? [], byLoinc), [observations, byLoinc]);

  return { readings, loading: observations === undefined || defsLoading, error };
}

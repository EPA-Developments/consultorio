// Hook del panel "¿Qué estudios solicitar?": reúne el estadío, las condiciones
// activas y las últimas Observations del paciente, y devuelve los gaps de
// estudios (motor en ckm/studies). Solo lectura, no persiste nada.
import type { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import { hasCKD, hasDiabetes, hasHeartFailure, hasHypertension, isActiveCondition } from '../clinical';
import { getCKMStage } from '../extensions';
import { getLatestCKMObservations } from '../observations';
import { evaluateStudyGaps } from '../studies';
import type { StudyGap } from '../studies';

export interface StudyRecommendations {
  gaps: StudyGap[];
  loading: boolean;
  /** true si falló la lectura: gaps vacío NO significa "paciente al día". */
  error: boolean;
}

export function useStudyRecommendations(patient: Patient | undefined): StudyRecommendations {
  const medplum = useMedplum();
  const [state, setState] = useState<StudyRecommendations>({ gaps: [], loading: true, error: false });

  useEffect(() => {
    if (!patient?.id) {
      setState({ gaps: [], loading: false, error: false });
      return;
    }
    let cancelled = false;
    setState({ gaps: [], loading: true, error: false });

    (async () => {
      const patientId = patient.id as string;
      const [values, conditions] = await Promise.all([
        getLatestCKMObservations(medplum, patientId),
        medplum.searchResources('Condition', { subject: `Patient/${patientId}`, _count: '200' }),
      ]);
      if (cancelled) {
        return;
      }
      const active = conditions.filter(isActiveCondition);
      const gaps = evaluateStudyGaps(
        {
          stage: getCKMStage(patient),
          flags: {
            diabetes: hasDiabetes(active),
            hypertension: hasHypertension(active),
            ckd: hasCKD(active),
            heartFailure: hasHeartFailure(active),
          },
        },
        values
      );
      setState({ gaps, loading: false, error: false });
    })().catch((err) => {
      console.error('useStudyRecommendations', err);
      if (!cancelled) {
        // Un error NO es "sin estudios pendientes": la pantalla tiene que
        // distinguir "al día" de "no pude evaluar".
        setState({ gaps: [], loading: false, error: true });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [medplum, patient]);

  return state;
}

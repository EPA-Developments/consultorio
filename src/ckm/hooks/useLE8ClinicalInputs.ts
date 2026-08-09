// Trae del servidor los 4 componentes clínicos de LE8 (presión, IMC, lípidos
// no-HDL, glucosa). Hace exactamente las mismas búsquedas y deriva los flags con
// los mismos criterios que usePreventBaseline / el bot ckm-recalculate, así el
// LE8 es coherente con el resto del panel. No persiste nada: solo lee.
import type { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import { deriveMedicationFlags, hasDiabetes, isActiveCondition } from '../clinical';
import { clinicalLE8Inputs } from '../le8-clinical';
import type { ClinicalLE8Inputs } from '../le8-clinical';
import { getLatestCKMObservations } from '../observations';

export interface LE8ClinicalData {
  /** Los 4 componentes clínicos disponibles (los que falten quedan fuera). */
  inputs: ClinicalLE8Inputs;
  loading: boolean;
  /** true si falló la lectura: "Sin dato" sería mentirle al que mira la rueda. */
  error: boolean;
}

// Referencia estable para el estado vacío, así los consumidores que derivan
// memos no entran en loop.
const EMPTY: ClinicalLE8Inputs = {};

/** Hook que devuelve los componentes clínicos de LE8 del paciente. */
export function useLE8ClinicalInputs(patient: Patient | undefined): LE8ClinicalData {
  const medplum = useMedplum();
  const [state, setState] = useState<LE8ClinicalData>({ inputs: EMPTY, loading: true, error: false });

  useEffect(() => {
    if (!patient?.id) {
      setState({ inputs: EMPTY, loading: false, error: false });
      return;
    }
    let cancelled = false;
    setState({ inputs: EMPTY, loading: true, error: false });

    (async () => {
      const patientId = patient.id as string;
      const [values, conditions, medications] = await Promise.all([
        getLatestCKMObservations(medplum, patientId),
        medplum.searchResources('Condition', { subject: `Patient/${patientId}`, _count: '200' }),
        medplum.searchResources('MedicationRequest', {
          subject: `Patient/${patientId}`,
          status: 'active',
          _count: '100',
        }),
      ]);
      if (cancelled) {
        return;
      }
      const active = conditions.filter(isActiveCondition);
      const { onAntihypertensive } = deriveMedicationFlags(medications);
      const inputs = clinicalLE8Inputs(values, { diabetes: hasDiabetes(active), onAntihypertensive });
      setState({ inputs, loading: false, error: false });
    })().catch((err) => {
      console.error('useLE8ClinicalInputs', err);
      if (!cancelled) {
        setState({ inputs: EMPTY, loading: false, error: true });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [medplum, patient]);

  return state;
}

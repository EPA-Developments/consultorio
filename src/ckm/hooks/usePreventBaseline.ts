// Reúne los insumos PREVENT actuales de un paciente desde el servidor para
// alimentar el simulador What-If: últimos valores observados (PA, lípidos,
// eGFR, IMC) + flags clínicos (diabetes, tabaquismo, medicación) + edad/sexo.
//
// Usa exactamente las mismas definiciones que el bot ckm-recalculate (módulo
// ckm/clinical), así el "basal" del simulador coincide con el score persistido.
import type { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import {
  ageFromBirthDate,
  deriveMedicationFlags,
  hasDiabetes,
  hasSmoking,
  isActiveCondition,
  patientPreventSex,
} from '../clinical';
import { getLatestCKMObservations } from '../observations';
import { buildPreventInputs } from '../prevent';
import type { PreventInputs } from '../prevent';

export interface PreventBaseline {
  /** Insumos completos si hay datos suficientes para calcular PREVENT. */
  inputs?: PreventInputs;
  /** Etiquetas en español de los datos faltantes (para mensaje al usuario). */
  missing: string[];
  loading: boolean;
  /**
   * true si falló la LECTURA. Antes el catch dejaba `missing: []`, y el
   * simulador mostraba "Falta cargar:" seguido de una lista vacía — un error
   * de red disfrazado de datos insuficientes sin decir cuáles.
   */
  error: boolean;
}

const REQUIRED_LABELS: Record<string, string> = {
  sbp: 'presión arterial sistólica',
  cholesterol: 'colesterol (total o no-HDL)',
  hdlc: 'colesterol HDL',
  egfr: 'filtrado glomerular (eGFR)',
  bmi: 'índice de masa corporal',
  age: 'edad entre 30 y 79 años',
  sex: 'sexo (masculino/femenino)',
};

/**
 * Hook que devuelve los insumos PREVENT basales del paciente. No persiste nada:
 * solo lee. `missing` enumera qué falta cuando no se puede calcular.
 */
export function usePreventBaseline(patient: Patient | undefined): PreventBaseline {
  const medplum = useMedplum();
  const [state, setState] = useState<PreventBaseline>({ missing: [], loading: true, error: false });

  useEffect(() => {
    if (!patient?.id) {
      setState({ missing: [], loading: false, error: false });
      return;
    }
    let cancelled = false;
    setState({ missing: [], loading: true, error: false });

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
      const sex = patientPreventSex(patient);
      const ageYears = ageFromBirthDate(patient.birthDate);
      const { onStatin, onAntihypertensive } = deriveMedicationFlags(medications);

      const inputs =
        sex &&
        buildPreventInputs(values, {
          sex,
          ageYears,
          diabetes: hasDiabetes(active),
          smoking: hasSmoking(active),
          onAntihypertensive,
          onStatin,
        });

      if (inputs) {
        setState({ inputs, missing: [], loading: false, error: false });
        return;
      }

      const missing: string[] = [];
      if (!sex) {
        missing.push(REQUIRED_LABELS.sex);
      }
      if (!(ageYears >= 30 && ageYears <= 79)) {
        missing.push(REQUIRED_LABELS.age);
      }
      if (values.sbp?.value === undefined) {
        missing.push(REQUIRED_LABELS.sbp);
      }
      if (values.cholesterolTotal?.value === undefined && values.nonHdlc?.value === undefined) {
        missing.push(REQUIRED_LABELS.cholesterol);
      }
      if (values.hdlc?.value === undefined) {
        missing.push(REQUIRED_LABELS.hdlc);
      }
      if (values.egfr?.value === undefined) {
        missing.push(REQUIRED_LABELS.egfr);
      }
      if (values.bmi?.value === undefined) {
        missing.push(REQUIRED_LABELS.bmi);
      }
      setState({ missing, loading: false, error: false });
    })().catch((err) => {
      console.error('usePreventBaseline', err);
      if (!cancelled) {
        setState({ missing: [], loading: false, error: true });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [medplum, patient]);

  return state;
}

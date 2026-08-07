// Evalúa el catálogo Bio contra los antecedentes del paciente.
//
// Solo lee: trae las Conditions activas y corre el gate. No escribe nada, no
// agenda y no registra sesiones — eso es el paso siguiente.
import type { Condition, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import { isActiveCondition } from '../../ckm/clinical';
import { evaluarCatalogo, ordenarPorRiesgo } from '../safety';
import type { EvaluacionTerapia } from '../safety';
import { todasLasTerapias } from '../therapy-catalog';

export interface BioSafetyData {
  evaluaciones?: EvaluacionTerapia[];
  loading: boolean;
}

export function useBioSafety(patient: Patient | undefined, situacionesDelDia: string[] = []): BioSafetyData {
  const medplum = useMedplum();
  const [data, setData] = useState<BioSafetyData>();
  const patientId = patient?.id;
  // Se serializa para que el efecto no se dispare por identidad del array.
  const situaciones = situacionesDelDia.join('|');

  useEffect(() => {
    if (!patientId) {
      setData(undefined);
      return;
    }
    let cancelled = false;
    setData({ loading: true });

    medplum
      .searchResources('Condition', { subject: `Patient/${patientId}`, _count: '200' })
      .then((conditions) => {
        if (cancelled) {
          return;
        }
        const activas = (conditions as Condition[]).filter(isActiveCondition);
        const evaluaciones = evaluarCatalogo(todasLasTerapias(), {
          condiciones: activas,
          situacionesDelDia: situaciones ? situaciones.split('|') : [],
        });
        setData({ evaluaciones: ordenarPorRiesgo(evaluaciones), loading: false });
      })
      .catch((err) => {
        console.error('Panel Bio: error evaluando seguridad', err);
        if (!cancelled) {
          setData({ loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [medplum, patientId, situaciones]);

  return data ?? { loading: false };
}

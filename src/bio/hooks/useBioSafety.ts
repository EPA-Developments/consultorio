// Evalúa el catálogo Bio contra los antecedentes del paciente y contra las
// sesiones que ya lleva hechas.
//
// Solo lee. Dos fuentes, en el mismo proyecto Medplum: las Conditions activas
// (qué tiene el paciente) y los Appointment de recepción (cuántas sesiones
// lleva). La segunda es la que habilita los topes de exposición acumulada, que
// hasta ahora estaban declarados en el catálogo y nunca se evaluaban porque
// nadie le pasaba el número al motor.
import type { Appointment, Condition, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import { isActiveCondition } from '../../ckm/clinical';
import { evaluarCatalogo, ordenarPorRiesgo } from '../safety';
import type { EvaluacionTerapia } from '../safety';
import { conteoParaGate, contarSesiones } from '../session-count';
import type { ConteoSesiones } from '../session-count';
import { todasLasTerapias } from '../therapy-catalog';

/**
 * Estados de turno que pueden contar como sesión administrada. Se filtra en el
 * servidor para no traerse la agenda entera del paciente; el contador vuelve a
 * filtrar igual, porque la regla vive ahí y no en el query.
 */
const ESTADOS_CONTABLES = 'fulfilled,arrived,checked-in';

export interface BioSafetyData {
  evaluaciones?: EvaluacionTerapia[];
  /** Conteo de sesiones con su metadata de confiabilidad, para mostrarlo. */
  conteo?: ConteoSesiones;
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

    Promise.all([
      medplum.searchResources('Condition', { subject: `Patient/${patientId}`, _count: '200' }),
      // Toda la historia, no la serie en curso: el tope de exposición se cuenta
      // a lo largo de todas las series.
      medplum.searchResources('Appointment', {
        patient: `Patient/${patientId}`,
        status: ESTADOS_CONTABLES,
        _count: '1000',
      }),
    ])
      .then(([conditions, appointments]) => {
        if (cancelled) {
          return;
        }
        const activas = (conditions as Condition[]).filter(isActiveCondition);
        const conteo = contarSesiones(appointments as Appointment[]);
        const evaluaciones = evaluarCatalogo(todasLasTerapias(), {
          condiciones: activas,
          situacionesDelDia: situaciones ? situaciones.split('|') : [],
          sesionesAcumuladas: conteoParaGate(conteo),
          origenConteo: conteo.origenConteo,
        });
        setData({ evaluaciones: ordenarPorRiesgo(evaluaciones), conteo, loading: false });
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

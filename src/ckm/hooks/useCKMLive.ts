// Cálculo CKM EN VIVO desde el servidor, sin depender del bot.
//
// El panel del chart mostraba únicamente lo que el bot `ckm-recalculate` había
// persistido en las extensiones del Patient. Si el bot no corrió —porque la
// entrega de Subscriptions del servidor self-hosted no dispara, porque el
// paciente se cargó recién, o porque el bot falló— el panel quedaba en "Sin
// métricas CKM registradas" AUNQUE los datos estuvieran cargados. El panel LE8,
// que sí calcula en vivo, mostraba los mismos datos sin problema.
//
// Este hook lee los mismos recursos que el bot y calcula con el MISMO módulo
// (ckm/compute.ts), así el resultado coincide con el que persistiría el bot.
//
// Es para el chart de UN paciente. NO usarlo en listados: hace 3 búsquedas por
// paciente.
import type { Condition, MedicationRequest, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import { isActiveCondition } from '../clinical';
import { computeCKMSnapshot } from '../compute';
import type { CKMSnapshot } from '../compute';
import { getLatestCKMObservations } from '../observations';

export interface CKMLiveData extends CKMSnapshot {
  loading: boolean;
}

const EMPTY: CKMLiveData = { metrics: [], loading: false };

/**
 * Calcula el CKM del paciente leyendo del servidor.
 *
 * @param patient - Paciente ya cargado (aporta sexo y fecha de nacimiento).
 * @param enabled - Si es false no hace ninguna búsqueda. Se usa para calcular
 *   solo cuando el bot no dejó datos persistidos, y no gastar llamadas de más.
 */
export function useCKMLive(patient: Patient | undefined, enabled: boolean): CKMLiveData {
  const medplum = useMedplum();
  const [data, setData] = useState<CKMLiveData>();
  const patientId = patient?.id;

  useEffect(() => {
    if (!enabled || !patientId) {
      setData(undefined);
      return;
    }
    let cancelled = false;
    setData({ metrics: [], loading: true });

    void (async () => {
      try {
        const [values, conditions, medications] = await Promise.all([
          getLatestCKMObservations(medplum, patientId),
          medplum.searchResources('Condition', { subject: `Patient/${patientId}`, _count: '200' }),
          medplum.searchResources('MedicationRequest', {
            subject: `Patient/${patientId}`,
            status: 'active',
            _count: '100',
          }) as Promise<MedicationRequest[]>,
        ]);
        if (cancelled) {
          return;
        }
        const active = (conditions as Condition[]).filter(isActiveCondition);
        setData({ ...computeCKMSnapshot(values, patient as Patient, active, medications), loading: false });
      } catch (err) {
        console.error('CKM en vivo: error calculando', err);
        if (!cancelled) {
          setData({ metrics: [], loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `patient` completo no va en las dependencias a propósito: cambia de
    // identidad en cada render de useResource y dispararía un bucle de fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medplum, patientId, enabled]);

  return data ?? EMPTY;
}

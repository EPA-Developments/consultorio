// Hook que trae las ObservationDefinitions de biomarcadores del servidor y las
// expone normalizadas e indexadas por LOINC. Si no hay ninguna cargada devuelve
// listas vacías; si FALLA la búsqueda lo dice con `error`, porque "no hay
// definiciones" (falta el seed) y "no pude leerlas" piden acciones distintas.
import { useMedplum } from '@medplum/react';
import { useEffect, useMemo, useState } from 'react';
import { getBiomarkerDefinitions, indexByLoinc } from '../observation-definitions';
import type { BiomarkerDefinition } from '../observation-definitions';

export interface ObservationDefinitionsData {
  definitions: BiomarkerDefinition[];
  byLoinc: Map<string, BiomarkerDefinition>;
  loading: boolean;
  /** true si la búsqueda falló: las listas vacías NO significan "sin catálogo". */
  error: boolean;
}

// Referencia estable para el estado "cargando/sin datos", así los consumidores
// que derivan memos del array (ej. lista de códigos) no entran en loop.
const EMPTY: BiomarkerDefinition[] = [];

export function useObservationDefinitions(): ObservationDefinitionsData {
  const medplum = useMedplum();
  const [definitions, setDefinitions] = useState<BiomarkerDefinition[]>();
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getBiomarkerDefinitions(medplum)
      .then((defs) => {
        if (!cancelled) {
          setDefinitions(defs);
        }
      })
      .catch((err) => {
        console.error('ObservationDefinitions: error buscando definiciones de biomarcadores', err);
        if (!cancelled) {
          setError(true);
          setDefinitions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [medplum]);

  const byLoinc = useMemo(() => indexByLoinc(definitions ?? EMPTY), [definitions]);

  return { definitions: definitions ?? EMPTY, byLoinc, loading: definitions === undefined, error };
}

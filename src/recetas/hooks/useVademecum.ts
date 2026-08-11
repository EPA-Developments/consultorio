// Búsqueda en vivo contra el vademécum del servidor (ValueSet/$expand).
//
// La lección REFEPS, aplicada al autocomplete: si el servidor no contesta,
// `caido` se prende y el formulario sigue entero con el catálogo local y el
// texto libre — la disponibilidad del vademécum NUNCA bloquea la
// prescripción. El error se muestra (description del campo), no se disfraza
// de "sin resultados".
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import { DIAGNOSTICOS_VALUESET_URL, VADEMECUM_VALUESET_URL } from '../vademecum';
import type { OpcionVademecum } from '../vademecum';

const MIN_CARACTERES = 3;
const DEBOUNCE_MS = 300;
const MAX_RESULTADOS = 10;

export function useVademecum(query: string): { opciones: OpcionVademecum[]; buscando: boolean; caido: boolean } {
  return useExpansion(VADEMECUM_VALUESET_URL, query);
}

/** Diagnósticos SNOMED (refset SUMAR), servidos por el mismo mecanismo. */
export function useDiagnosticos(query: string): { opciones: OpcionVademecum[]; buscando: boolean; caido: boolean } {
  return useExpansion(DIAGNOSTICOS_VALUESET_URL, query);
}

function useExpansion(url: string, query: string): { opciones: OpcionVademecum[]; buscando: boolean; caido: boolean } {
  const medplum = useMedplum();
  const [opciones, setOpciones] = useState<OpcionVademecum[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [caido, setCaido] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CARACTERES) {
      setOpciones([]);
      setBuscando(false);
      return undefined;
    }
    let cancelled = false;
    setBuscando(true);
    const timer = setTimeout(() => {
      medplum
        .valueSetExpand({ url, filter: q, count: MAX_RESULTADOS })
        .then((vs) => {
          if (!cancelled) {
            setOpciones(
              (vs.expansion?.contains ?? [])
                .filter((c) => c.code && c.display)
                .map((c) => ({ code: c.code as string, display: c.display as string }))
            );
            setCaido(false);
          }
        })
        .catch((err) => {
          console.error('Vademécum: $expand no respondió', err);
          if (!cancelled) {
            setOpciones([]);
            setCaido(true);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setBuscando(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [medplum, url, query]);

  return { opciones, buscando, caido };
}

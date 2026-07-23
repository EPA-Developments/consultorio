// Catálogo del recetario: las 50 ObservationDefinition normalizadas a ítems de
// orden (LabOrderItem) y agrupadas por panel, en el mismo orden que el panel de
// biomarcadores. Reutiliza useObservationDefinitions (misma fuente de verdad).
// Solo lee.
import { useMemo } from 'react';
import { groupByPanel } from '../../ckm/observation-definitions';
import { useObservationDefinitions } from '../../ckm/hooks/useObservationDefinitions';
import { toLabOrderItem } from '../lab-order';
import type { LabOrderItem } from '../lab-order';

export interface LabOrderPanelGroup {
  panelCode: string;
  panelDisplay: string;
  items: LabOrderItem[];
}

export interface LabOrderCatalog {
  items: LabOrderItem[];
  byPanel: LabOrderPanelGroup[];
  loading: boolean;
}

export function useLabOrderCatalog(): LabOrderCatalog {
  const { definitions, loading } = useObservationDefinitions();

  const byPanel = useMemo<LabOrderPanelGroup[]>(
    () =>
      groupByPanel(definitions).map((group) => ({
        panelCode: group.panelCode,
        panelDisplay: group.panelDisplay,
        items: group.defs.map(toLabOrderItem),
      })),
    [definitions]
  );

  const items = useMemo(() => byPanel.flatMap((g) => g.items), [byPanel]);

  return { items, byPanel, loading };
}

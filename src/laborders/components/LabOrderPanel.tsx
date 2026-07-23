// Tab "Órdenes de laboratorio" de la ficha del paciente (recetario, Fase 1).
// El médico arma el pedido de los 50 marcadores en 1-2 clicks: elige un preset
// (perfil completo o un panel) o tilda marcadores sueltos, elige la cobertura y
// genera la orden. Cada análisis solicitable se crea como un ServiceRequest
// (intent 'order', category laboratorio) y todos comparten un mismo
// `requisition` (el número de orden). Abajo se listan las órdenes ya emitidas.
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { Bundle, Patient, ServiceRequest } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconAlertTriangle, IconCircleCheck, IconFlask, IconInfoCircle } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  buildLabOrder,
  COBERTURAS_PRIVADAS,
  groupByRequisition,
  LABORATORY_CATEGORY,
  ORDERABILITY_INFO,
  resolveDerivedSources,
} from '../lab-order';
import type { LabOrderItem } from '../lab-order';
import { useLabOrderCatalog } from '../hooks/useLabOrderCatalog';

/** Genera un número de orden legible a partir de un UUID del navegador. */
function newRequisitionId(): string {
  return 'ORD-' + crypto.randomUUID().slice(0, 8).toUpperCase();
}

export function LabOrderPanel(props: { patient: Patient }): JSX.Element {
  const medplum = useMedplum();
  const { items, byPanel, loading } = useLabOrderCatalog();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cobertura, setCobertura] = useState<string>(COBERTURAS_PRIVADAS[0]);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [existing, setExisting] = useState<ServiceRequest[]>();

  const byId = useMemo(() => new Map(items.map((i) => [i.biomarcadorId ?? '', i])), [items]);

  // Ids que realmente se van a solicitar (expandidos con las fuentes de los
  // derivados, y filtrados a los solicitables).
  const orderableIds = useMemo(() => {
    const expanded = resolveDerivedSources([...selected], items);
    return expanded.filter((id) => byId.get(id)?.orderable);
  }, [selected, items, byId]);

  // Carga las órdenes de laboratorio ya emitidas para el paciente.
  useEffect(() => {
    let cancelled = false;
    setExisting(undefined);
    medplum
      .searchResources('ServiceRequest', {
        subject: `Patient/${props.patient.id}`,
        category: LABORATORY_CATEGORY.coding?.[0]?.code,
        _sort: '-authored',
        _count: '200',
      })
      .then((reqs) => {
        if (!cancelled) {
          setExisting(reqs);
        }
      })
      .catch((err) => {
        console.error('LabOrderPanel: error buscando órdenes', err);
        if (!cancelled) {
          setExisting([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [medplum, props.patient.id, reloadKey]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectPanel = useCallback((panelItems: LabOrderItem[]) => {
    setSelected(new Set(panelItems.filter((i) => i.orderable).map((i) => i.biomarcadorId ?? '')));
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(items.filter((i) => i.orderable).map((i) => i.biomarcadorId ?? '')));
  }, [items]);

  const clear = useCallback(() => setSelected(new Set()), []);

  async function generateOrder(): Promise<void> {
    if (orderableIds.length === 0) {
      return;
    }
    setCreating(true);
    try {
      const profile = medplum.getProfile();
      const requester = profile?.resourceType === 'Practitioner' ? createReference(profile) : undefined;
      const orderItems = orderableIds.map((id) => byId.get(id)).filter((i): i is LabOrderItem => Boolean(i));

      const orders = buildLabOrder({
        subject: createReference(props.patient),
        requester,
        items: orderItems,
        requisitionId: newRequisitionId(),
        authoredOn: new Date().toISOString(),
        intent: 'order',
        note: `Cobertura: ${cobertura}`,
      });

      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: orders.map((resource) => ({ request: { method: 'POST', url: 'ServiceRequest' }, resource })),
      };
      await medplum.executeBatch(bundle);

      showNotification({
        icon: <IconCircleCheck />,
        color: 'teal',
        title: 'Orden generada',
        message: `${orders.length} análisis solicitados (${cobertura}).`,
      });
      clear();
      setReloadKey((k) => k + 1);
    } catch (err) {
      showNotification({ color: 'red', title: 'Error al generar la orden', message: normalizeErrorString(err) });
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <Loader m="xl" />;
  }

  const noPractitioner = medplum.getProfile()?.resourceType !== 'Practitioner';

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Title order={4}>Órdenes de laboratorio</Title>
        <Text c="dimmed" size="sm">
          Elegí un preset o tildá los marcadores, seleccioná la cobertura y generá la orden. Cada análisis se emite como
          un pedido y todos quedan agrupados en un mismo número de orden.
        </Text>
      </Stack>

      {/* Presets: 1 click arma la selección. */}
      <Group gap="xs">
        <Button size="xs" variant="filled" leftSection={<IconFlask size={14} />} onClick={selectAll}>
          Perfil completo
        </Button>
        {byPanel.map((group) => (
          <Button key={group.panelCode} size="xs" variant="light" onClick={() => selectPanel(group.items)}>
            {group.panelDisplay}
          </Button>
        ))}
        {selected.size > 0 && (
          <Button size="xs" variant="subtle" color="gray" onClick={clear}>
            Limpiar
          </Button>
        )}
      </Group>

      {/* Catálogo por panel con checkboxes. */}
      <Stack gap="lg">
        {byPanel.map((group) => (
          <Paper key={group.panelCode} withBorder p="sm" radius="sm">
            <Text fw={600} size="sm" mb="xs">
              {group.panelDisplay}
            </Text>
            <Table verticalSpacing={4}>
              <Table.Tbody>
                {group.items.map((item) => {
                  const info = ORDERABILITY_INFO[item.orderability];
                  const id = item.biomarcadorId ?? '';
                  // Un derivado se marca "incluido" cuando su fuente está seleccionada.
                  const includedAsDerived =
                    !item.orderable &&
                    item.orderability === 'derived' &&
                    (item.derivedFrom ?? []).every((src) => selected.has(src));
                  return (
                    <Table.Tr key={id}>
                      <Table.Td w={36}>
                        <Checkbox
                          size="sm"
                          checked={selected.has(id)}
                          disabled={!item.orderable}
                          onChange={() => toggle(id)}
                          aria-label={item.label}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c={item.orderable ? undefined : 'dimmed'}>
                          {item.label}
                        </Text>
                      </Table.Td>
                      <Table.Td w={160}>
                        <Tooltip label={info.note ?? info.label} disabled={!info.note} multiline w={240}>
                          <Badge color={info.color} variant="light" size="sm" style={{ cursor: 'default' }}>
                            {info.label}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td w={150}>
                        {includedAsDerived && (
                          <Text size="xs" c="teal">
                            Incluido con su fuente
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Paper>
        ))}
      </Stack>

      {/* Barra de acción: cobertura + generar. */}
      <Paper withBorder p="md" radius="sm" pos="sticky" bottom={0} bg="var(--mantine-color-body)">
        <Group justify="space-between" align="flex-end">
          <Group align="flex-end" gap="md">
            <Select
              label="Cobertura"
              data={COBERTURAS_PRIVADAS as unknown as string[]}
              value={cobertura}
              onChange={(v) => setCobertura(v ?? COBERTURAS_PRIVADAS[0])}
              w={180}
              allowDeselect={false}
            />
            <Text size="sm" c="dimmed">
              {orderableIds.length} análisis a solicitar
            </Text>
          </Group>
          <Button
            leftSection={<IconFlask size={16} />}
            disabled={orderableIds.length === 0}
            loading={creating}
            onClick={() => void generateOrder()}
          >
            Generar orden
          </Button>
        </Group>
        {noPractitioner && orderableIds.length > 0 && (
          <Alert mt="sm" color="yellow" icon={<IconAlertTriangle size={16} />} variant="light">
            Tu perfil no es un Practitioner, así que la orden se creará sin profesional solicitante. Para la emisión
            legal (Fase 2) la orden debe llevar la matrícula del médico.
          </Alert>
        )}
      </Paper>

      {/* Órdenes ya emitidas. */}
      <ExistingOrders existing={existing} />
    </Stack>
  );
}

function ExistingOrders(props: { existing?: ServiceRequest[] }): JSX.Element {
  if (props.existing === undefined) {
    return <Loader size="sm" />;
  }
  if (props.existing.length === 0) {
    return (
      <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
        Sin órdenes de laboratorio emitidas para este paciente.
      </Alert>
    );
  }
  const groups = [...groupByRequisition(props.existing).entries()];
  return (
    <Stack gap="xs">
      <Title order={5}>Órdenes emitidas</Title>
      {groups.map(([requisitionId, reqs]) => {
        const proposal = reqs.some((r) => r.intent === 'proposal');
        const authored = reqs.find((r) => r.authoredOn)?.authoredOn;
        return (
          <Paper key={requisitionId} withBorder p="sm" radius="sm">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={2}>
                <Group gap="xs">
                  <Text fw={600} size="sm">
                    {requisitionId}
                  </Text>
                  {proposal ? (
                    <Badge color="orange" variant="light" size="sm">
                      Solicitud del paciente
                    </Badge>
                  ) : (
                    <Badge color="teal" variant="light" size="sm">
                      Orden médica
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {reqs.length} análisis · {authored ? new Date(authored).toLocaleDateString('es-AR') : 'sin fecha'}
                </Text>
              </Stack>
              <Text size="xs" c="dimmed" ta="right" style={{ maxWidth: 320 }}>
                {reqs
                  .map((r) => r.code?.text)
                  .filter(Boolean)
                  .join(', ')}
              </Text>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}

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
import { createReference, formatHumanName, normalizeErrorString } from '@medplum/core';
import type { Bundle, Patient, Practitioner, ServiceRequest } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconFlask,
  IconInfoCircle,
  IconPrinter,
  IconStethoscope,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ErrorCarga } from '../../components/ErrorCarga';
import { checkPractitionerForEmission, matriculaOf } from '../practitioner-validation';
import { checkRefeps, isRejected } from '../refeps-client';
import {
  approveProposals,
  chunk,
  COBERTURAS_PRIVADAS,
  groupByRequisition,
  LABORATORY_CATEGORY,
  ORDERABILITY_INFO,
  panelDelPreset,
  resolveDerivedSources,
} from '../lab-order';
import type { LabOrderItem } from '../lab-order';
import { constanciaRefeps } from '../emission-gate';
import { createLabOrder, EXT_REFEPS_VERIFICACION } from '../lab-order-create';
import { buildEmissionProvenance, emissionStatusOf, getSello, sealOrder, withSeal } from '../lab-order-emission';
import type { EmissionStatus } from '../lab-order-emission';
import { buildPrintData, printHtmlDocument, renderLabOrderHtml } from '../lab-order-print';
import { useLabOrderCatalog } from '../hooks/useLabOrderCatalog';

export function LabOrderPanel(props: {
  patient: Patient;
  /** Preset a preseleccionar al cargar (?preset= de /laboratorio): panelCode, nombre de panel o 'completo'. */
  presetInicial?: string;
}): JSX.Element {
  const medplum = useMedplum();
  const { items, byPanel, loading, error: catalogoError } = useLabOrderCatalog();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cobertura, setCobertura] = useState<string>(COBERTURAS_PRIVADAS[0]);
  const [creating, setCreating] = useState(false);
  const [approvingId, setApprovingId] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [existing, setExisting] = useState<ServiceRequest[]>();
  const [existingError, setExistingError] = useState(false);

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
    setExistingError(false);
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
          // "Sin órdenes emitidas" con la lectura caída invita a EMITIR DE
          // NUEVO una orden que ya existe: el paciente termina con dos.
          setExistingError(true);
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

  // Preselección por URL (?preset=): se aplica UNA vez cuando el catálogo
  // está listo, y nunca pisa una selección que el médico ya empezó a mano.
  const presetAplicado = useRef(false);
  useEffect(() => {
    if (!props.presetInicial || presetAplicado.current || loading || byPanel.length === 0) {
      return;
    }
    presetAplicado.current = true;
    const elegido = panelDelPreset(props.presetInicial, byPanel);
    if (elegido === 'completo') {
      selectAll();
    } else if (elegido) {
      selectPanel(elegido.items);
    }
  }, [props.presetInicial, loading, byPanel, selectAll, selectPanel]);

  async function generateOrder(): Promise<void> {
    if (orderableIds.length === 0) {
      return;
    }
    setCreating(true);
    try {
      const orderItems = orderableIds.map((id) => byId.get(id)).filter((i): i is LabOrderItem => Boolean(i));

      const { requests, refeps } = await createLabOrder(medplum, {
        patient: props.patient,
        items: orderItems,
        intent: 'order',
        note: `Cobertura: ${cobertura}`,
      });

      // La orden salió igual, pero "verificada" y "sin verificar" no son la
      // misma noticia: la segunda se muestra en amarillo y sin cerrarse sola.
      if (refeps?.unavailable) {
        showNotification({
          color: 'yellow',
          title: 'Orden generada SIN verificación REFEPS',
          message: `${requests.length} análisis solicitados (${cobertura}). ${refeps.unavailableReason ?? 'El registro no respondió.'} La orden deja constancia de que salió sin verificar.`,
          autoClose: false,
        });
      } else {
        showNotification({
          icon: <IconCircleCheck />,
          color: 'teal',
          title: 'Orden generada',
          message: `${requests.length} análisis solicitados (${cobertura}). Matrícula verificada en REFEPS.`,
        });
      }
      clear();
      setReloadKey((k) => k + 1);
    } catch (err) {
      showNotification({ color: 'red', title: 'Error al generar la orden', message: normalizeErrorString(err) });
    } finally {
      setCreating(false);
    }
  }

  // Imprime (o "Guardar como PDF") una orden ya emitida. Resuelve el
  // profesional desde el requester de la orden; si no se puede, usa el perfil
  // actual (si es Practitioner).
  async function printOrder(requisitionId: string, reqs: ServiceRequest[]): Promise<void> {
    let practitioner: Practitioner | undefined;
    const ref = reqs.map((r) => r.requester).find((r) => r?.reference?.startsWith('Practitioner/'));
    try {
      if (ref) {
        const res = await medplum.readReference(ref);
        if (res.resourceType === 'Practitioner') {
          practitioner = res;
        }
      }
    } catch (err) {
      console.warn('LabOrderPanel: no se pudo resolver el profesional de la orden', err);
    }
    if (!practitioner) {
      const profile = medplum.getProfile();
      if (profile?.resourceType === 'Practitioner') {
        practitioner = profile;
      }
    }
    // El documento declara SOLO el estado que puede probar: la firma se
    // confirma leyendo el Provenance; si esa lectura falla, se imprime como
    // borrador (conservador y veraz), nunca al revés.
    let hasSignature = false;
    const first = reqs[0];
    if (first?.id && getSello(first)) {
      try {
        const provs = await medplum.searchResources('Provenance', {
          target: `ServiceRequest/${first.id}`,
          _count: '1',
        });
        hasSignature = provs.some((p) => (p.signature?.length ?? 0) > 0);
      } catch (err) {
        console.error('LabOrderPanel: no se pudo leer la firma (Provenance)', err);
      }
    }
    const emissionStatus: EmissionStatus = first ? emissionStatusOf(first, hasSignature) : 'draft';

    const data = buildPrintData({
      emissionStatus,
      requisitionId,
      requests: reqs,
      patient: props.patient,
      practitioner,
      logoUrl: '/logo.png',
    });
    printHtmlDocument(renderLabOrderHtml(data));
  }

  // Aprueba una solicitud del paciente: convierte sus propuestas en órdenes
  // médicas emitidas, selladas con la matrícula del profesional logueado. Las
  // actualizaciones se fragmentan en tandas (el servidor rechaza transacciones
  // con más de 50 PUT), así una solicitud del panel completo (~50 análisis) no
  // rebota.
  async function approveOrder(requisitionId: string, reqs: ServiceRequest[]): Promise<void> {
    const profile = medplum.getProfile();
    if (profile?.resourceType !== 'Practitioner') {
      return;
    }
    // Solo las propuestas (las ya emitidas se dejan como están).
    const proposals = reqs.filter((r) => r.intent === 'proposal');
    if (proposals.length === 0) {
      return;
    }

    // Aprobar ES emitir: mismo acto legal, mismo gate que generateOrder.
    // Este camino salteaba las dos validaciones y sellaba con la matrícula
    // "si estaba".
    setApprovingId(requisitionId);
    const check = checkPractitionerForEmission(profile as Practitioner);
    if (!check.canEmit) {
      showNotification({ color: 'red', title: 'No se puede aprobar', message: check.problems.join(' ') });
      setApprovingId(undefined);
      return;
    }
    const refeps = await checkRefeps(medplum, profile as Practitioner);
    if (isRejected(refeps)) {
      showNotification({
        color: 'red',
        title: 'REFEPS rechazó la emisión',
        message: refeps.verification?.message ?? 'La matrícula no está en condiciones según el registro.',
        autoClose: false,
      });
      setApprovingId(undefined);
      return;
    }

    const name = profile.name?.[0] ? formatHumanName(profile.name[0]) : 'el profesional';
    const matricula = matriculaOf(profile as Practitioner);
    const fecha = new Date().toLocaleDateString('es-AR');
    // La misma constancia que emite createLabOrder: una sola redacción para
    // los dos caminos de emisión, o el papel dice cosas distintas según por
    // qué botón se pasó.
    const constancia = constanciaRefeps(refeps, new Date().toISOString()) + '.';
    const approvalNote = `Aprobada y emitida por ${name}${matricula ? ` (Matrícula ${matricula})` : ''} el ${fecha}. ${constancia} Originada como solicitud del paciente.`;
    const approved = approveProposals({ proposals, requester: createReference(profile), approvalNote }).map((r) => ({
      ...r,
      extension: [
        ...(r.extension ?? []),
        { url: EXT_REFEPS_VERIFICACION, valueString: refeps.unavailable ? 'no-verificable' : 'verificado' },
      ],
    }));

    // Aprobar ES emitir, así que sella y firma igual que createLabOrder. El
    // sello se calcula sobre las órdenes YA aprobadas: el requester entra en el
    // contenido canónico, y antes de aprobar todavía no estaba.
    const when = new Date().toISOString();
    const seal = await sealOrder(approved);
    const selladas = approved.map((r) => ({ ...r, identifier: withSeal(r, seal) }));
    const provenance = buildEmissionProvenance({
      requests: selladas,
      practitioner: profile as Practitioner,
      when,
      seal,
    });

    try {
      // El Provenance viaja en la ÚLTIMA tanda, no en una escritura aparte: así
      // la firma llega en la misma transacción que el último PUT en lugar de
      // agregar un paso propio que puede fallar solo y dejar órdenes emitidas
      // sin firma, sin camino de reintento (al dejar de ser 'proposal' este
      // botón ya no vuelve a ofrecerlas).
      const grupos = chunk(selladas);
      for (const [i, group] of grupos.entries()) {
        const bundle: Bundle = {
          resourceType: 'Bundle',
          type: 'transaction',
          entry: [
            ...group.map((resource) => ({
              request: { method: 'PUT' as const, url: `ServiceRequest/${resource.id}` },
              resource,
            })),
            ...(i === grupos.length - 1
              ? [{ request: { method: 'POST' as const, url: 'Provenance' }, resource: provenance }]
              : []),
          ],
        };
        await medplum.executeBatch(bundle);
      }
      if (refeps.unavailable) {
        showNotification({
          color: 'yellow',
          title: 'Solicitud aprobada SIN verificación REFEPS',
          message: `${approved.length} análisis emitidos. ${refeps.unavailableReason ?? 'El registro no respondió.'} La orden deja constancia.`,
          autoClose: false,
        });
      } else {
        showNotification({
          icon: <IconCircleCheck />,
          color: 'teal',
          title: 'Solicitud aprobada',
          message: `${approved.length} análisis emitidos como orden médica. Matrícula verificada en REFEPS.`,
        });
      }
      setReloadKey((k) => k + 1);
    } catch (err) {
      showNotification({ color: 'red', title: 'Error al aprobar la solicitud', message: normalizeErrorString(err) });
    } finally {
      setApprovingId(undefined);
    }
  }

  if (loading) {
    return <Loader m="xl" />;
  }
  // Con el catálogo caído, el recetario mostraría el título y "0 análisis a
  // solicitar" — y la culpa parecería del seed, no de la lectura.
  if (catalogoError) {
    return <ErrorCarga que="el catálogo de análisis" />;
  }

  const isPractitioner = medplum.getProfile()?.resourceType === 'Practitioner';
  const noPractitioner = !isPractitioner;

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
      <ExistingOrders
        existing={existing}
        error={existingError}
        onPrint={printOrder}
        onApprove={approveOrder}
        canApprove={isPractitioner}
        approvingId={approvingId}
      />
    </Stack>
  );
}

function ExistingOrders(props: {
  existing?: ServiceRequest[];
  error?: boolean;
  onPrint: (requisitionId: string, reqs: ServiceRequest[]) => void | Promise<void>;
  onApprove: (requisitionId: string, reqs: ServiceRequest[]) => void | Promise<void>;
  canApprove: boolean;
  approvingId?: string;
}): JSX.Element {
  if (props.existing === undefined) {
    return <Loader size="sm" />;
  }
  if (props.error) {
    return <ErrorCarga que="las órdenes emitidas de este paciente" />;
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
              <Group gap="sm" wrap="nowrap" align="center">
                <Text size="xs" c="dimmed" ta="right" style={{ maxWidth: 260 }}>
                  {reqs
                    .map((r) => r.code?.text)
                    .filter(Boolean)
                    .join(', ')}
                </Text>
                {proposal && props.canApprove && (
                  <Button
                    size="xs"
                    color="teal"
                    leftSection={<IconStethoscope size={14} />}
                    loading={props.approvingId === requisitionId}
                    onClick={() => void props.onApprove(requisitionId, reqs)}
                  >
                    Aprobar y emitir
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPrinter size={14} />}
                  onClick={() => void props.onPrint(requisitionId, reqs)}
                >
                  Imprimir / PDF
                </Button>
              </Group>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}

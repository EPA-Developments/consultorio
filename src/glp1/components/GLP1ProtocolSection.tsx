// Protocolo de titulación y monitoreo (Opción B del camino CKM → GLP-1).
//
// Arma el esquema de ficha técnica ajustado a este paciente para que el médico
// lo revise. NO prescribe el GLP-1: no emite receta del fármaco ni indica la
// dosis final, que son del profesional.
//
// Sí escribe dos cosas, ambas a pedido explícito y por los mismos caminos que
// ya existen en el dashboard:
// - Las órdenes de laboratorio de cada control, con el recetario.
// - El CarePlan con sus Task de control, que nace en 'draft' para que lo
//   active el médico.
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Select,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Timeline,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import {
  IconAlertTriangle,
  IconCalendarCheck,
  IconCircleCheck,
  IconClipboardPlus,
  IconFlask,
  IconInfoCircle,
  IconTargetArrow,
  IconVaccine,
} from '@tabler/icons-react';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { useLabOrderCatalog } from '../../laborders/hooks/useLabOrderCatalog';
import { COBERTURAS_PRIVADAS } from '../../laborders/lab-order';
import { createLabOrder } from '../../laborders/lab-order-create';
import type { Flag, GLP1Assessment, GLP1Inputs } from '../eligibility';
import type { MonitoringVisit } from '../monitoring';
import { createGLP1Plan } from '../careplan-create';
import { monitoringOrderNote, planOrderFor } from '../monitoring-order';
import type { GLP1Protocol } from '../protocol';
import { buildProtocol } from '../protocol';
import { INDICATION_LABELS, PRESENTATION_LABELS, indicationFor, moleculesFor } from '../titration';

export function GLP1ProtocolSection(props: {
  patient: Patient;
  inputs: GLP1Inputs;
  assessment: GLP1Assessment;
}): JSX.Element | null {
  const { inputs, assessment } = props;
  const indication = indicationFor(inputs);
  const medplum = useMedplum();
  const { items: catalogo } = useLabOrderCatalog();
  const [cobertura, setCobertura] = useState<string>(COBERTURAS_PRIVADAS[0]);
  const [agendando, setAgendando] = useState(false);

  async function agendar(protocolo: GLP1Protocol): Promise<void> {
    if (!props.patient.id) {
      return;
    }
    setAgendando(true);
    try {
      const { tasks } = await createGLP1Plan(medplum, { protocol: protocolo, patientId: props.patient.id });
      showNotification({
        icon: <IconCircleCheck />,
        color: 'teal',
        title: 'Plan creado en borrador',
        message: `${tasks.length} controles agendados. El plan queda para revisar y activar.`,
      });
    } catch (err) {
      showNotification({ color: 'red', title: 'Error al agendar', message: normalizeErrorString(err) });
    } finally {
      setAgendando(false);
    }
  }

  // Se ofrecen primero las moléculas sugeridas para este perfil, y después el
  // resto de las que tienen esquema para la indicación: la sugerencia orienta,
  // no restringe.
  const opciones = useMemo(() => {
    const sugeridas = assessment.molecules.map((m) => m.molecule);
    const conEsquema = moleculesFor(indication);
    const ordenadas = [
      ...sugeridas.filter((m) => conEsquema.includes(m)),
      ...conEsquema.filter((m) => !sugeridas.includes(m)),
    ];
    return [...new Set(ordenadas)];
  }, [assessment.molecules, indication]);

  const [molecula, setMolecula] = useState<string | null>(null);
  const elegida = molecula ?? opciones[0] ?? null;
  const protocolo = elegida ? buildProtocol(inputs, elegida) : undefined;

  if (opciones.length === 0) {
    return null;
  }

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Group gap="xs">
          <ThemeIcon color="copper" variant="light" radius="md">
            <IconVaccine size={18} />
          </ThemeIcon>
          <Text fw={600}>Protocolo de titulación y monitoreo</Text>
        </Group>
        <Text c="dimmed" size="sm">
          Esquema de ficha técnica ajustado a este paciente. La indicación, el producto y la dosis final son del
          profesional.
        </Text>
      </Stack>

      <Group align="flex-end" gap="md">
        <Select label="Molécula" data={opciones} value={elegida} onChange={setMolecula} allowDeselect={false} w={240} />
        <Select
          label="Cobertura"
          data={[...COBERTURAS_PRIVADAS]}
          value={cobertura}
          onChange={(v) => setCobertura(v ?? COBERTURAS_PRIVADAS[0])}
          allowDeselect={false}
          w={180}
        />
        <Badge variant="light" size="lg" mb={6}>
          {INDICATION_LABELS[indication]}
        </Badge>
      </Group>

      {!protocolo ? (
        <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">No hay esquema cargado para esta molécula en esta indicación.</Text>
        </Alert>
      ) : (
        <>
          <Card withBorder radius="md" p="md">
            <Group justify="space-between" mb="xs" wrap="nowrap" align="flex-start">
              <Text fw={600}>Escalonamiento</Text>
              <Badge variant="light" color="gray">
                {PRESENTATION_LABELS[protocolo.titration.presentation]}
              </Badge>
            </Group>
            <Table.ScrollContainer minWidth={420}>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={60}>Paso</Table.Th>
                    <Table.Th>Dosis</Table.Th>
                    <Table.Th w={130}>Duración mínima</Table.Th>
                    <Table.Th>Nota</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {protocolo.titration.steps.map((s) => (
                    <Table.Tr key={s.step}>
                      <Table.Td>{s.step}</Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text fw={600} size="sm">
                            {s.dose}
                          </Text>
                          {!s.therapeutic && (
                            <Badge size="xs" variant="light" color="gray">
                              inicio
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{s.weeks === 1 ? '1 semana' : `${s.weeks} semanas`}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {s.note ?? ''}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Text size="sm" mt="sm">
              Dosis máxima: <strong>{protocolo.titration.maxDose}</strong>
            </Text>
            <List size="sm" spacing={4} mt="xs">
              {protocolo.titration.notes.map((n) => (
                <List.Item key={n}>{n}</List.Item>
              ))}
            </List>
            <Text size="xs" c="dimmed" fs="italic" mt="sm">
              {protocolo.titration.source}
            </Text>
          </Card>

          {protocolo.adjustments.length > 0 && (
            <Card withBorder radius="md" p="md" style={{ borderColor: 'var(--mantine-color-orange-4)' }}>
              <Group gap="xs" mb="xs">
                <ThemeIcon color="orange" variant="light" radius="md">
                  <IconAlertTriangle size={18} />
                </ThemeIcon>
                <Text fw={600}>Ajustar la medicación que ya recibe</Text>
              </Group>
              <FlagList flags={protocolo.adjustments} />
            </Card>
          )}

          <Card withBorder radius="md" p="md">
            <Group gap="xs" mb="xs">
              <ThemeIcon color="yellow" variant="light" radius="md">
                <IconAlertTriangle size={18} />
              </ThemeIcon>
              <Text fw={600}>Qué vigilar</Text>
            </Group>
            <FlagList flags={protocolo.safety} />
          </Card>

          <Card withBorder radius="md" p="md">
            <Group justify="space-between" mb="md" wrap="nowrap" align="flex-start">
              <Group gap="xs">
                <ThemeIcon color="blue" variant="light" radius="md">
                  <IconCalendarCheck size={18} />
                </ThemeIcon>
                <Text fw={600}>Calendario de controles</Text>
              </Group>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconClipboardPlus size={14} />}
                loading={agendando}
                onClick={() => void agendar(protocolo)}
              >
                Agendar los {protocolo.monitoring.length} controles
              </Button>
            </Group>
            <Timeline active={0} bulletSize={18} lineWidth={2}>
              {protocolo.monitoring.map((v) => (
                <Timeline.Item key={`${v.weeks}-${v.label}`} title={v.label}>
                  <Text size="sm" c="dimmed" mb={6}>
                    {v.purpose}
                  </Text>
                  <List size="sm" spacing={2}>
                    {v.checks.map((c) => (
                      <List.Item key={c}>{c}</List.Item>
                    ))}
                  </List>
                  {v.labs.length > 0 && (
                    <VisitLabs
                      visit={v}
                      patient={props.patient}
                      molecule={protocolo.molecule}
                      cobertura={cobertura}
                      catalog={catalogo}
                    />
                  )}
                </Timeline.Item>
              ))}
            </Timeline>
            <Text size="xs" c="dimmed" mt="md">
              La orden se emite igual que desde la pestaña "Órdenes de laboratorio", y aparece ahí para imprimir.
            </Text>
          </Card>

          <Card withBorder radius="md" p="md">
            <Group gap="xs" mb="xs">
              <ThemeIcon color="teal" variant="light" radius="md">
                <IconTargetArrow size={18} />
              </ThemeIcon>
              <Text fw={600}>Revisión de respuesta · semana {protocolo.response.weeks}</Text>
            </Group>
            <Text size="sm" mb="xs">
              {protocolo.response.criterion}
            </Text>
            <Text size="sm" fw={600} mt="sm" mb={4}>
              Si no se alcanza, revisar en este orden:
            </Text>
            <List size="sm" spacing={4} type="ordered">
              {protocolo.response.ifNotMet.map((x) => (
                <List.Item key={x}>{x}</List.Item>
              ))}
            </List>
          </Card>
        </>
      )}
    </Stack>
  );
}

/**
 * Los estudios de una visita, con el botón que emite la orden.
 *
 * Muestra los ítems tal como van a quedar en la orden, no como los nombra el
 * calendario: el HOMA-IR y el eGFR se piden a través de sus fuentes, y decirlo
 * evita que el médico crea que se perdieron.
 */
function VisitLabs(props: {
  visit: MonitoringVisit;
  patient: Patient;
  molecule: string;
  cobertura: string;
  catalog: ReturnType<typeof useLabOrderCatalog>['items'];
}): JSX.Element {
  const medplum = useMedplum();
  const [emitiendo, setEmitiendo] = useState(false);
  const plan = useMemo(() => planOrderFor(props.visit.labs, props.catalog), [props.visit.labs, props.catalog]);

  async function emitir(): Promise<void> {
    setEmitiendo(true);
    try {
      const { requests, refeps } = await createLabOrder(medplum, {
        patient: props.patient,
        items: plan.items,
        intent: 'order',
        note: monitoringOrderNote(props.visit.label, props.molecule, props.cobertura),
      });
      if (refeps?.unavailable) {
        showNotification({
          color: 'yellow',
          title: 'Orden generada SIN verificación REFEPS',
          message: `${requests.length} análisis solicitados para ${props.visit.label}. El registro no respondió; la orden deja constancia.`,
          autoClose: false,
        });
      } else {
        showNotification({
          icon: <IconCircleCheck />,
          color: 'teal',
          title: 'Orden generada',
          message: `${requests.length} análisis solicitados para ${props.visit.label}. Matrícula verificada en REFEPS.`,
        });
      }
    } catch (err) {
      showNotification({ color: 'red', title: 'Error al generar la orden', message: normalizeErrorString(err) });
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <Stack gap={6} mt={8}>
      <Group gap={6}>
        {plan.items.map((i) => (
          <Badge key={i.biomarcadorId} size="sm" variant="light" color="blue">
            {i.label}
          </Badge>
        ))}
      </Group>

      {plan.replacedDerived.length > 0 && (
        <Text size="xs" c="dimmed">
          {plan.replacedDerived.length === 1 ? 'Se pide' : 'Se piden'} {plan.replacedDerived.join(', ')} a través de sus
          análisis fuente, que ya están en la lista.
        </Text>
      )}
      {(plan.unknown.length > 0 || plan.notOrderable.length > 0) && (
        <Text size="xs" c="orange">
          Queda fuera de la orden: {[...plan.unknown, ...plan.notOrderable].join(', ')}.
        </Text>
      )}

      <Group>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconFlask size={14} />}
          loading={emitiendo}
          disabled={plan.items.length === 0}
          onClick={() => void emitir()}
        >
          Solicitar {plan.items.length} {plan.items.length === 1 ? 'análisis' : 'análisis'}
        </Button>
      </Group>
    </Stack>
  );
}

function FlagList(props: { flags: Flag[] }): JSX.Element {
  return (
    <Stack gap="xs">
      {props.flags.map((f) => (
        <div key={f.text}>
          <Text size="sm">{f.text}</Text>
          {f.source && (
            <Text size="xs" c="dimmed" fs="italic">
              {f.source}
            </Text>
          )}
        </div>
      ))}
    </Stack>
  );
}

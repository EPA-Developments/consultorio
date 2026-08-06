// Protocolo de titulación y monitoreo (Opción B del camino CKM → GLP-1).
//
// SOLO LECTURA, igual que el panel de elegibilidad: arma el esquema de ficha
// técnica ajustado a este paciente para que el médico lo revise. No prescribe,
// no emite recetas y no escribe ningún recurso.
import { Alert, Badge, Card, Group, List, Select, Stack, Table, Text, ThemeIcon, Timeline } from '@mantine/core';
import { IconAlertTriangle, IconCalendarCheck, IconInfoCircle, IconTargetArrow, IconVaccine } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import type { Flag, GLP1Assessment, GLP1Inputs } from '../eligibility';
import { buildProtocol } from '../protocol';
import { INDICATION_LABELS, PRESENTATION_LABELS, indicationFor, moleculesFor } from '../titration';

export function GLP1ProtocolSection(props: { inputs: GLP1Inputs; assessment: GLP1Assessment }): JSX.Element | null {
  const { inputs, assessment } = props;
  const indication = indicationFor(inputs);

  // Se ofrecen primero las moléculas sugeridas para este perfil, y después el
  // resto de las que tienen esquema para la indicación: la sugerencia orienta,
  // no restringe.
  const opciones = useMemo(() => {
    const sugeridas = assessment.molecules.map((m) => m.molecule);
    const conEsquema = moleculesFor(indication);
    const ordenadas = [...sugeridas.filter((m) => conEsquema.includes(m)), ...conEsquema.filter((m) => !sugeridas.includes(m))];
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
        <Select
          label="Molécula"
          data={opciones}
          value={elegida}
          onChange={setMolecula}
          allowDeselect={false}
          w={240}
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
            <Group gap="xs" mb="md">
              <ThemeIcon color="blue" variant="light" radius="md">
                <IconCalendarCheck size={18} />
              </ThemeIcon>
              <Text fw={600}>Calendario de controles</Text>
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
                    <Group gap={6} mt={8}>
                      {v.labs.map((l) => (
                        <Badge key={l} size="sm" variant="light" color="blue">
                          {l}
                        </Badge>
                      ))}
                    </Group>
                  )}
                </Timeline.Item>
              ))}
            </Timeline>
            <Text size="xs" c="dimmed" mt="md">
              Los estudios se pueden solicitar desde la pestaña "Órdenes de laboratorio".
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

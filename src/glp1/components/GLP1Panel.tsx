// Panel "Elegibilidad GLP-1" del chart del paciente (Camino CKM → GLP-1).
//
// SOLO LECTURA. No prescribe, no calcula dosis y no escribe nada: muestra el
// fenotipo metabólico, si hay criterios de candidatura, las contraindicaciones
// y precauciones, qué datos faltan y qué moléculas tienen evidencia para este
// perfil. La decisión es del médico.
import { Alert, Badge, Card, Group, List, Loader, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import type { Patient } from '@medplum/fhirtypes';
import {
  IconAlertTriangle,
  IconBan,
  IconCircleCheck,
  IconFlask,
  IconInfoCircle,
  IconVaccine,
} from '@tabler/icons-react';
import type { JSX } from 'react';
import { CANDIDACY_LABELS, PHENOTYPE_LABELS, PROTOCOL_PROVISIONAL_NOTE, PROTOCOL_VERIFIED } from '../eligibility';
import type { Flag } from '../eligibility';
import { useGLP1Assessment } from '../hooks/useGLP1Assessment';

export function GLP1Panel(props: { patient: Patient }): JSX.Element {
  const { assessment, loading } = useGLP1Assessment(props.patient);

  if (loading) {
    return <Loader m="xl" />;
  }
  if (!assessment) {
    return (
      <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
        No se pudo evaluar la elegibilidad. Revisá que el paciente tenga datos cargados.
      </Alert>
    );
  }

  const candidatura = CANDIDACY_LABELS[assessment.candidacy];

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Title order={4}>Elegibilidad GLP-1</Title>
        <Text c="dimmed" size="sm">
          Soporte a la decisión, de solo lectura. No constituye una indicación: la evaluación y la prescripción son del
          profesional.
        </Text>
      </Stack>

      {!PROTOCOL_VERIFIED && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm">{PROTOCOL_PROVISIONAL_NOTE}</Text>
        </Alert>
      )}

      {/* Encabezado: fenotipo + candidatura */}
      <Card withBorder radius="md" p="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Fenotipo metabólico
            </Text>
            <Text fw={600} size="lg">
              {PHENOTYPE_LABELS[assessment.phenotype]}
            </Text>
          </Stack>
          <Badge color={candidatura.color} variant="light" size="lg">
            {candidatura.label}
          </Badge>
        </Group>
      </Card>

      {/* Contraindicaciones: primero, porque bloquean */}
      {assessment.blockers.length > 0 && (
        <Card withBorder radius="md" p="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
          <Group gap="xs" mb="xs">
            <ThemeIcon color="red" variant="light" radius="md">
              <IconBan size={18} />
            </ThemeIcon>
            <Text fw={600}>Contraindicaciones</Text>
          </Group>
          <FlagList flags={assessment.blockers} />
        </Card>
      )}

      {/* Motivos de candidatura */}
      {assessment.rationale.length > 0 && (
        <Card withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon color="teal" variant="light" radius="md">
              <IconCircleCheck size={18} />
            </ThemeIcon>
            <Text fw={600}>Criterios que cumple</Text>
          </Group>
          <FlagList flags={assessment.rationale} />
        </Card>
      )}

      {/* Precauciones */}
      {assessment.cautions.length > 0 && (
        <Card withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon color="orange" variant="light" radius="md">
              <IconAlertTriangle size={18} />
            </ThemeIcon>
            <Text fw={600}>Precauciones y ajustes</Text>
          </Group>
          <FlagList flags={assessment.cautions} />
        </Card>
      )}

      {/* Moléculas con evidencia */}
      {assessment.molecules.length > 0 && (
        <Card withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon color="copper" variant="light" radius="md">
              <IconVaccine size={18} />
            </ThemeIcon>
            <Text fw={600}>Moléculas con evidencia para este perfil</Text>
          </Group>
          <Stack gap="sm">
            {assessment.molecules.map((m) => (
              <div key={m.molecule}>
                <Text fw={600} size="sm">
                  {m.molecule}
                </Text>
                <Text size="sm" c="dimmed">
                  {m.reason}
                </Text>
                <Text size="xs" c="dimmed" fs="italic">
                  {m.evidence}
                </Text>
              </div>
            ))}
          </Stack>
          <Text size="xs" c="dimmed" mt="sm">
            Se nombra el principio activo, no la marca. La elección del producto, la vía de cobertura y la dosis son del
            profesional.
          </Text>
        </Card>
      )}

      {/* Datos faltantes: accionable, se piden con el recetario */}
      {assessment.missingData.length > 0 && (
        <Card withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon color="blue" variant="light" radius="md">
              <IconFlask size={18} />
            </ThemeIcon>
            <Text fw={600}>Faltan datos para completar la evaluación</Text>
          </Group>
          <List size="sm" spacing={4}>
            {assessment.missingData.map((d) => (
              <List.Item key={d}>{d}</List.Item>
            ))}
          </List>
          <Text size="xs" c="dimmed" mt="sm">
            Se pueden solicitar desde la pestaña "Órdenes de laboratorio".
          </Text>
        </Card>
      )}

      {assessment.candidacy === 'no-candidato' && assessment.blockers.length === 0 && (
        <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">
            Hoy no reúne criterios de candidatura. Conviene revisar la evaluación si cambian el peso, la cintura o el
            perfil glucémico.
          </Text>
        </Alert>
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

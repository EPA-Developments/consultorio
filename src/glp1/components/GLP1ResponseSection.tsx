// Seguimiento longitudinal de la respuesta (Opción C del camino CKM → GLP-1).
//
// SOLO LECTURA. Grafica peso, IMC, cintura y HbA1c contra las fechas del plan
// vigente, y dice si el paciente está respondiendo — pero recién a partir de la
// fecha de revisión, no antes.
import { Alert, Badge, Card, Group, List, Loader, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import type { Patient } from '@medplum/fhirtypes';
import { IconChartLine, IconInfoCircle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useGLP1Response } from '../hooks/useGLP1Response';
import { REVISION_ANTES_DE_CONCLUIR } from '../monitoring';
import { VERDICT_LABELS } from '../response';
import { ResponseChart } from './ResponseChart';

/**
 * Devuelve null si el paciente no tiene un plan GLP-1 vigente. La sección habla
 * de un tratamiento en curso: sin plan no hay nada que seguir, y un cartel de
 * "todavía no hay plan" sería ruido en un panel que trata de elegibilidad.
 */
export function GLP1ResponseSection(props: { patient: Patient }): JSX.Element | null {
  const { assessment, timeline, sinPlan, loading } = useGLP1Response(props.patient);

  if (loading) {
    return <Loader m="xl" />;
  }
  if (sinPlan || !assessment || !timeline) {
    return null;
  }

  const veredicto = VERDICT_LABELS[assessment.verdict];
  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Group gap="xs">
          <ThemeIcon color="blue" variant="light" radius="md">
            <IconChartLine size={18} />
          </ThemeIcon>
          <Title order={5}>Respuesta al tratamiento</Title>
        </Group>
        <Text c="dimmed" size="sm">
          Medido contra el basal del plan{timeline.molecule ? ` de ${timeline.molecule}` : ''}, iniciado el{' '}
          {timeline.planStartIso.slice(0, 10)}.
        </Text>
      </Stack>

      <Card withBorder radius="md" p="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Estado
            </Text>
            <Text size="sm">{assessment.message}</Text>
            {assessment.weightLossSource === 'imc' && (
              <Text size="xs" c="dimmed">
                Calculado sobre el IMC, porque no hay peso registrado. Con la talla estable, el cambio porcentual es el
                mismo.
              </Text>
            )}
          </Stack>
          <Badge color={veredicto.color} variant="light" size="lg">
            {veredicto.label}
          </Badge>
        </Group>
      </Card>

      {assessment.verdict === 'no-responde' && (
        <Card withBorder radius="md" p="md" style={{ borderColor: 'var(--mantine-color-orange-4)' }}>
          <Text fw={600} size="sm" mb="xs">
            Antes de concluir que no responde, revisar en este orden:
          </Text>
          <List size="sm" spacing={4} type="ordered">
            {REVISION_ANTES_DE_CONCLUIR.map((x) => (
              <List.Item key={x}>{x}</List.Item>
            ))}
          </List>
        </Card>
      )}

      {assessment.metrics.map((m) => (
        <Card withBorder radius="md" p="md" key={m.id}>
          <Text fw={600} size="sm" mb="xs">
            {m.label}
            {m.unit ? ` (${m.unit})` : ''}
          </Text>
          {m.points.length === 1 ? (
            <Text size="sm" c="dimmed">
              Una sola medición ({m.points[0].value} {m.unit ?? ''} el {m.points[0].date.slice(0, 10)}). Hace falta otra
              para poder comparar.
            </Text>
          ) : (
            <ResponseChart metric={m} markers={timeline.markers} reviewDate={timeline.reviewDateIso} />
          )}
        </Card>
      ))}

      {assessment.metrics.length === 0 && (
        <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">
            No hay mediciones cargadas todavía. Se cargan con los controles del plan: peso, cintura, presión y los
            estudios de cada visita.
          </Text>
        </Alert>
      )}
    </Stack>
  );
}

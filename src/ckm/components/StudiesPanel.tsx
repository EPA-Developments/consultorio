// Panel "¿Qué estudios solicitar?" (v1): sugiere estudios diagnósticos/
// complementarios según el estadío CKM y las condiciones del paciente, y marca
// con gap analysis qué falta (🔴), qué está vencido (🟡) o al día (🟢).
// Solo sugerencia/lectura; no genera órdenes (eso queda para v2).
import { Badge, Group, Paper, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { formatDate } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { IconFlask, IconInfoCircle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { CKMStageBadge } from './CKMStageBadge';
import { getCKMStage } from '../extensions';
import { ErrorCarga } from '../../components/ErrorCarga';
import { useStudyRecommendations } from '../hooks/useStudyRecommendations';
import type { StudyGap, StudyStatus } from '../studies';

export interface StudiesPanelProps {
  patient: Patient;
}

const STATUS_META: Record<StudyStatus, { color: string; label: string }> = {
  missing: { color: 'red', label: 'Pendiente' },
  overdue: { color: 'yellow', label: 'Vencido' },
  current: { color: 'teal', label: 'Al día' },
  info: { color: 'gray', label: 'Sugerido' },
};

export function StudiesPanel(props: StudiesPanelProps): JSX.Element {
  const { patient } = props;
  const { gaps, loading, error } = useStudyRecommendations(patient);
  const stage = getCKMStage(patient);

  const count = (s: StudyStatus): number => gaps.filter((g) => g.status === s).length;

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between" gap="xs">
          <Group gap="xs" wrap="nowrap">
            <IconFlask size={18} />
            <Title order={4}>¿Estudios a solicitar?</Title>
          </Group>
          {stage !== undefined && <CKMStageBadge stage={stage} size="md" />}
        </Group>

        {error ? (
          <ErrorCarga que="los estudios a solicitar" />
        ) : loading ? (
          <Text size="sm" c="dimmed">
            Calculando…
          </Text>
        ) : gaps.length === 0 ? (
          <Text size="sm" c="dimmed">
            Sin estudios sugeridos para el estadío y las condiciones actuales.
          </Text>
        ) : (
          <>
            <Group gap="xs">
              {count('missing') > 0 && (
                <Badge color="red" variant="light">
                  🔴 {count('missing')} pendientes
                </Badge>
              )}
              {count('overdue') > 0 && (
                <Badge color="yellow" variant="light">
                  🟡 {count('overdue')} vencidos
                </Badge>
              )}
              {count('current') > 0 && (
                <Badge color="teal" variant="light">
                  🟢 {count('current')} al día
                </Badge>
              )}
            </Group>

            <Stack gap={6}>
              {gaps.map((g) => (
                <StudyRow key={g.rule.id} gap={g} />
              ))}
            </Stack>

            <Text size="xs" c="dimmed">
              Sugerencia basada en el marco CKM (AHA / Ndumele et al., Circulation 2023). No reemplaza el juicio
              clínico. (v1: solo sugerencia; las órdenes se generan en una próxima versión.)
            </Text>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function StudyRow(props: { gap: StudyGap }): JSX.Element {
  const { rule, status, lastDate, monthsSince, intervalMonths } = props.gap;
  const meta = STATUS_META[status];

  let detail = '';
  if (status === 'missing') {
    detail = 'Nunca registrado';
  } else if (lastDate) {
    detail = `Último: ${formatDate(lastDate)}` + (monthsSince !== undefined ? ` (hace ${monthsSince} m)` : '');
    if (intervalMonths) {
      detail += ` · cada ${intervalMonths} m`;
    }
  } else if (status === 'current') {
    detail = 'Registrado';
  } else {
    detail = 'Verificar manualmente';
  }

  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Badge color={meta.color} variant="light" size="sm" style={{ flexShrink: 0 }}>
          {meta.label}
        </Badge>
        <Text size="sm" lineClamp={1}>
          {rule.label}
        </Text>
        <Tooltip label={rule.rationale} multiline w={280} withArrow>
          <ThemeIcon size="sm" variant="subtle" color="gray">
            <IconInfoCircle size={14} />
          </ThemeIcon>
        </Tooltip>
      </Group>
      <Text size="xs" c="dimmed" ta="right" style={{ flexShrink: 0 }}>
        {detail}
      </Text>
    </Group>
  );
}

// Panel de biomarcadores BioWellness de un paciente, agrupado por categoría
// (metabólico, lipídico, inflamación, …). Para cada biomarcador muestra el
// último valor del paciente, los rangos convencional/óptimo y un estado
// (Óptimo/Normal/Alto/Bajo) clasificado contra los rangos de su
// ObservationDefinition. Solo lectura.
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { formatHumanName } from '@medplum/core';
import type { HumanName } from '@medplum/fhirtypes';
import { IconArrowLeft, IconDatabaseImport, IconInfoCircle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';
import { Sparkline } from '../ckm/components/Sparkline';
import { useBiomarkerPanel } from '../ckm/hooks/useBiomarkerPanel';
import { ErrorCarga } from '../components/ErrorCarga';
import { classifyBiomarkerValue } from '../ckm/observation-definitions';
import type { BiomarkerDefinition, BiomarkerPanelGroup, CodedValue } from '../ckm/observation-definitions';

const DEFAULT_OPEN = ['metabolico', 'lipidico', 'inflamacion'];

export function BiomarkerPanelPage(): JSX.Element {
  const { patientId } = useParams();
  const { patient, groups, valuesByCode, historyByCode, gender, ageYears, loading, error } =
    useBiomarkerPanel(patientId);

  if (loading) {
    return <Loader m="xl" />;
  }

  const patientName = patient?.name?.[0] ? formatHumanName(patient.name[0] as HumanName) : 'Paciente';

  return (
    <Paper shadow="xs" m="md" p="md" maw={1000} mx="auto">
      <Stack gap="md">
        <Stack gap={4}>
          <Anchor component={Link} to={`/Patient/${patientId}`} size="sm">
            <Group gap={4} wrap="nowrap">
              <IconArrowLeft size={14} />
              Volver al chart
            </Group>
          </Anchor>
          <Title order={3}>Panel de biomarcadores</Title>
          <Text c="dimmed" size="sm">
            {patientName} · {groups.reduce((n, g) => n + g.defs.length, 0)} biomarcadores BioWellness. Estado
            clasificado contra los rangos convencional y óptimo (Medicina 3.0) de cada definición.
          </Text>
        </Stack>

        {error ? (
          <ErrorCarga que="el panel de biomarcadores" />
        ) : groups.length === 0 ? (
          <Alert color="yellow" icon={<IconDatabaseImport size={18} />} title="No hay definiciones cargadas">
            <Text size="sm">
              No se encontraron ObservationDefinitions de biomarcadores. Cargá el panel desde{' '}
              <Anchor component={Link} to="/upload/biomarkers">
                la carga de definiciones
              </Anchor>{' '}
              y volvé a esta página.
            </Text>
          </Alert>
        ) : (
          <Accordion multiple defaultValue={DEFAULT_OPEN} variant="separated">
            {groups.map((group) => (
              <PanelSection
                key={group.panelCode}
                group={group}
                valuesByCode={valuesByCode}
                historyByCode={historyByCode}
                gender={gender}
                ageYears={ageYears}
              />
            ))}
          </Accordion>
        )}

        <Text size="xs" c="dimmed">
          Rangos óptimos de referencia (Medicina 3.0): orientativos, revisar con el equipo médico. El estado se calcula
          según el género del paciente cuando la definición lo distingue.
        </Text>
      </Stack>
    </Paper>
  );
}

function PanelSection(props: {
  group: BiomarkerPanelGroup;
  valuesByCode: Map<string, CodedValue>;
  historyByCode: Map<string, CodedValue[]>;
  gender?: string;
  ageYears?: number;
}): JSX.Element {
  const { group, valuesByCode, historyByCode, gender, ageYears } = props;
  const withData = group.defs.filter((d) => d.code && valuesByCode.has(d.code)).length;

  return (
    <Accordion.Item value={group.panelCode}>
      <Accordion.Control>
        <Group justify="space-between" wrap="nowrap" pr="md">
          <Text fw={600}>{group.panelDisplay}</Text>
          <Text size="xs" c="dimmed">
            {withData}/{group.defs.length} con datos
          </Text>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <Table verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Biomarcador</Table.Th>
              <Table.Th>Valor</Table.Th>
              <Table.Th>Tendencia</Table.Th>
              <Table.Th>Convencional</Table.Th>
              <Table.Th>Óptimo</Table.Th>
              <Table.Th>Estado</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {group.defs.map((def) => (
              <BiomarkerRow
                key={def.biomarcadorId ?? def.code ?? def.label}
                def={def}
                reading={def.code ? valuesByCode.get(def.code) : undefined}
                history={def.code ? historyByCode.get(def.code) : undefined}
                gender={gender}
                ageYears={ageYears}
              />
            ))}
          </Table.Tbody>
        </Table>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function trendLabel(history: CodedValue[], def: BiomarkerDefinition): string {
  const first = history[0];
  const last = history[history.length - 1];
  const unit = last.unit ?? def.unit ?? '';
  const date = last.date ? ` · último ${last.date.slice(0, 10)}` : '';
  return `${history.length} lecturas · ${first.value} → ${last.value} ${unit}${date}`.trim();
}

function BiomarkerRow(props: {
  def: BiomarkerDefinition;
  reading?: CodedValue;
  history?: CodedValue[];
  gender?: string;
  ageYears?: number;
}): JSX.Element {
  const { def, reading, history, gender, ageYears } = props;
  const status = classifyBiomarkerValue(def, reading?.value, gender, ageYears);

  return (
    <Table.Tr>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <Text size="sm">{def.label}</Text>
          {(def.interpretation || def.source) && (
            <Tooltip
              label={`${def.interpretation ?? ''}${def.source ? ` (Fuente: ${def.source})` : ''}`}
              withArrow
              multiline
              maw={360}
              events={{ hover: true, focus: false, touch: true }}
            >
              <IconInfoCircle
                size={14}
                role="img"
                color="var(--mantine-color-dimmed)"
                aria-label={`Sobre ${def.label}`}
              />
            </Tooltip>
          )}
        </Group>
      </Table.Td>
      <Table.Td>
        {reading ? (
          <Text size="sm">
            {reading.value} {reading.unit ?? def.unit ?? ''}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        {history && history.length >= 2 ? (
          <Tooltip label={trendLabel(history, def)} withArrow events={{ hover: true, focus: false, touch: true }}>
            <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
              <Sparkline
                values={history.map((h) => h.value)}
                dotColor={`var(--mantine-color-${status.color}-6)`}
                label={trendLabel(history, def)}
              />
            </span>
          </Tooltip>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed">
          {def.conventionalText ?? '—'}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed">
          {def.optimalText ?? '—'}
        </Text>
      </Table.Td>
      <Table.Td>
        {reading ? (
          <Badge color={status.color} variant="light" style={{ cursor: 'default' }}>
            {status.label}
          </Badge>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

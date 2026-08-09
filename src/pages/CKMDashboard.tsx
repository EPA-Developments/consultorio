// Panel de trabajo del especialista CKM: pacientes filtrables por estadío y
// nombre, ordenables por estadío y por riesgo PREVENT, con alertas sin leer.
import { Group, MultiSelect, Paper, Table, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { Loading, useMedplum } from '@medplum/react';
import { IconAlertCircle, IconChevronDown, IconChevronUp, IconSearch, IconSelector } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { CKMStageBadge } from '../ckm/components/CKMStageBadge';
import { RiskBadge } from '../ckm/components/RiskBadge';
import { CKM_STAGES } from '../ckm/constants';
import { compareRows, loadDashboardRows } from '../ckm/dashboard';
import type { DashboardRow, DashboardSort, DashboardSortField } from '../ckm/dashboard';
import { CAC_RECLASS_LEGEND, isProvisional, PROVISIONAL_NOTE } from '../ckm/risk';
import type { PreventOutcome } from '../ckm/risk';
import type { CKMStage } from '../ckm/types';

const STAGE_OPTIONS = (Object.keys(CKM_STAGES) as unknown as CKMStage[]).map((stage) => ({
  value: String(stage),
  label: `${stage} — ${CKM_STAGES[stage].label}`,
}));

export function CKMDashboard(): JSX.Element {
  const medplum = useMedplum();
  const [rows, setRows] = useState<DashboardRow[]>();
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [nameFilter, setNameFilter] = useState('');
  const [sort, setSort] = useState<DashboardSort>();

  useEffect(() => {
    loadDashboardRows(medplum).then(setRows).catch(console.error);
  }, [medplum]);

  const visibleRows = useMemo(() => {
    if (!rows) {
      return undefined;
    }
    let result = rows;
    if (stageFilter.length > 0) {
      result = result.filter((row) => row.stage !== undefined && stageFilter.includes(String(row.stage)));
    }
    if (nameFilter.trim()) {
      const query = nameFilter.trim().toLowerCase();
      result = result.filter((row) => row.name.toLowerCase().includes(query));
    }
    if (sort) {
      result = [...result].sort((a, b) => compareRows(sort, a, b));
    }
    return result;
  }, [rows, stageFilter, nameFilter, sort]);

  function toggleSort(field: DashboardSortField): void {
    setSort((current) =>
      current?.field === field ? { field, descending: !current.descending } : { field, descending: true }
    );
  }

  if (!visibleRows) {
    return <Loading />;
  }

  return (
    <Paper shadow="xs" m="md" p="md">
      <Group mb="md" grow>
        <MultiSelect
          label="Estadío CKM"
          placeholder={stageFilter.length === 0 ? 'Todos' : undefined}
          data={STAGE_OPTIONS}
          value={stageFilter}
          onChange={setStageFilter}
          clearable
        />
        <TextInput
          label="Paciente"
          placeholder="Buscar por nombre..."
          leftSection={<IconSearch size={16} />}
          value={nameFilter}
          onChange={(e) => setNameFilter(e.currentTarget.value)}
        />
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Paciente</Table.Th>
            <SortableTh label="Estadío" field="stage" sort={sort} onSort={toggleSort} />
            <SortableTh label="ASCVD 10a" field="ascvd10y" sort={sort} onSort={toggleSort} />
            <SortableTh
              label={`IC 10a${isProvisional('hf10y') ? ' *' : ''}`}
              field="hf10y"
              sort={sort}
              onSort={toggleSort}
            />
            <SortableTh
              label={`ECV 30a${isProvisional('cvdTotal30y') ? ' *' : ''}`}
              field="cvdTotal30y"
              sort={sort}
              onSort={toggleSort}
            />
            <Table.Th>Alertas</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {visibleRows.map((row) => (
            <Table.Tr key={row.patient.id}>
              <Table.Td>
                <Text component={Link} to={`/Patient/${row.patient.id}`} fw={500} c="copper.7">
                  {row.name}
                </Text>
              </Table.Td>
              <Table.Td>
                {row.stage !== undefined ? (
                  <CKMStageBadge stage={row.stage} size="sm" />
                ) : (
                  <Text c="dimmed" span>
                    —
                  </Text>
                )}
              </Table.Td>
              <RiskCell outcome="ascvd10y" value={row.ascvd10y} cac={row.cac} />
              <RiskCell outcome="hf10y" value={row.hf10y} />
              <RiskCell outcome="cvdTotal30y" value={row.cvdTotal30y} />
              <Table.Td>
                {row.hasAlert && (
                  <Tooltip label="Tiene alertas sin leer" withArrow>
                    <IconAlertCircle size={20} color="var(--mantine-color-red-6)" />
                  </Tooltip>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {visibleRows.length === 0 && (
        <Text c="dimmed" ta="center" p="md">
          No hay pacientes que coincidan con los filtros.
        </Text>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        {PROVISIONAL_NOTE}
      </Text>
      {visibleRows.some((row) => row.cac !== undefined) && (
        <Text size="xs" c="dimmed">
          {CAC_RECLASS_LEGEND}
        </Text>
      )}
    </Paper>
  );
}

function RiskCell(props: { outcome: PreventOutcome; value?: number; cac?: number }): JSX.Element {
  return (
    <Table.Td>
      {props.value !== undefined ? (
        <Group gap="xs" wrap="nowrap">
          <Text>{props.value}%</Text>
          <RiskBadge outcome={props.outcome} value={props.value} cac={props.cac} />
        </Group>
      ) : (
        <Text c="dimmed" span>
          —
        </Text>
      )}
    </Table.Td>
  );
}

function SortableTh(props: {
  label: string;
  field: DashboardSortField;
  sort?: DashboardSort;
  onSort: (field: DashboardSortField) => void;
}): JSX.Element {
  const active = props.sort?.field === props.field;
  const Icon = active ? (props.sort?.descending ? IconChevronDown : IconChevronUp) : IconSelector;
  return (
    <Table.Th>
      <UnstyledButton onClick={() => props.onSort(props.field)} fz="sm" fw={700}>
        <Group gap={4} wrap="nowrap">
          {props.label}
          <Icon size={14} />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

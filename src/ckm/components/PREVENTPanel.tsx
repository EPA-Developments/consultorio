// Panel CKM del chart del paciente: hGraph arriba, scores PREVENT abajo, el
// badge del estadío en el encabezado y acceso al cuestionario SDOH.
import { Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { formatDate } from '@medplum/core';
import type { Patient, Reference } from '@medplum/fhirtypes';
import { Loading } from '@medplum/react';
import { IconAdjustments, IconClipboardText, IconFlask } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { getPREVENTInputs } from '../extensions';
import { useCKMData } from '../hooks/useCKMData';
import { ErrorCarga } from '../../components/ErrorCarga';
import { useCKMLive } from '../hooks/useCKMLive';
import { CAC_RECLASS_LEGEND, isProvisional, PROVISIONAL_NOTE } from '../risk';
import type { PreventOutcome } from '../risk';
import { CKMStageBadge } from './CKMStageBadge';
import { HGraph } from './HGraph';
import { RiskBadge } from './RiskBadge';
import { RiskEnhancers } from './RiskEnhancers';

export interface PREVENTPanelProps {
  patient: Patient | Reference<Patient> | string;
}

export function PREVENTPanel(props: PREVENTPanelProps): JSX.Element {
  const persisted = useCKMData(props.patient);
  const { patient, loading } = persisted;

  // Si el bot todavía no persistió métricas, calcularlas en vivo con el mismo
  // módulo que usa el bot. Así el panel muestra los datos que YA están cargados
  // aunque la Subscription no haya disparado (ver hooks/useCKMLive.ts).
  const needsLive = !loading && (persisted.hGraphMetrics?.length ?? 0) === 0;
  const live = useCKMLive(patient, needsLive);

  if (loading) {
    return <Loading />;
  }

  const isLive = needsLive && !live.loading && live.metrics.length > 0;
  const hGraphMetrics = isLive ? live.metrics : persisted.hGraphMetrics;
  const stage = isLive ? (live.stage ?? persisted.stage) : persisted.stage;
  const preventScores = isLive ? (live.prevent ?? persisted.preventScores) : persisted.preventScores;

  const sdoh = getPREVENTInputs(patient).sdoh;
  // El CAC (si existe entre las métricas) reclasifica la categoría de ASCVD.
  const cac = hGraphMetrics?.find((m) => m.id === 'cac')?.value;

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Title order={4}>Salud CKM</Title>
          {stage !== undefined && <CKMStageBadge stage={stage} size="md" />}
        </Group>
        {needsLive && live.loading && (
          <Text size="xs" c="dimmed">
            Calculando…
          </Text>
        )}
        {isLive && (
          <Text size="xs" c="dimmed">
            Calculado en vivo a partir de las observaciones cargadas (el recálculo automático todavía no lo guardó).
          </Text>
        )}
        {/* Sin esto, un error del cálculo en vivo se veía como "Sin métricas
            CKM registradas": el médico entendía que faltaban datos cargados. */}
        {needsLive && live.error && <ErrorCarga que="las métricas CKM calculadas en vivo" />}
        <HGraph metrics={hGraphMetrics ?? []} />
        <SimpleGrid cols={3}>
          <ScoreStat label="ASCVD 10 años" outcome="ascvd10y" value={preventScores?.ascvd10y} cac={cac} />
          <ScoreStat label="IC 10 años" outcome="hf10y" value={preventScores?.hf10y} />
          <ScoreStat label="ECV total 30 años" outcome="cvdTotal30y" value={preventScores?.cvdTotal30y} />
        </SimpleGrid>
        <Text size="xs" c="dimmed">
          {PROVISIONAL_NOTE}
        </Text>
        {cac !== undefined && (
          <Text size="xs" c="dimmed">
            {CAC_RECLASS_LEGEND}
          </Text>
        )}
        <RiskEnhancers patientId={patient?.id} />
        <Button
          component={Link}
          to={`/ckm/biomarkers/${patient?.id}`}
          variant="light"
          size="xs"
          fullWidth
          leftSection={<IconFlask size={16} />}
        >
          Panel de biomarcadores
        </Button>
        <Button
          component={Link}
          to={`/ckm/simulator/${patient?.id}`}
          variant="light"
          size="xs"
          fullWidth
          leftSection={<IconAdjustments size={16} />}
        >
          Simulador ¿Y si...?
        </Button>
        <Group justify="space-between" wrap="nowrap">
          <Button
            component={Link}
            to={`/ckm/sdoh/${patient?.id}`}
            variant="light"
            size="xs"
            leftSection={<IconClipboardText size={16} />}
          >
            Cuestionario SDOH
          </Button>
          <Text size="xs" c="dimmed" ta="right">
            {sdoh
              ? `SDOH respondido el ${formatDate(sdoh.authored)}` +
                (sdoh.score !== undefined ? ` · score ${sdoh.score}` : '')
              : 'SDOH sin responder'}
          </Text>
        </Group>
      </Stack>
    </Paper>
  );
}

function ScoreStat(props: { label: string; outcome: PreventOutcome; value?: number; cac?: number }): JSX.Element {
  const label = isProvisional(props.outcome) ? `${props.label} *` : props.label;
  return (
    <Stack gap={4} align="center">
      <Text fz={28} fw={700} lh={1.2}>
        {props.value !== undefined ? `${props.value}%` : '—'}
      </Text>
      <RiskBadge outcome={props.outcome} value={props.value} cac={props.cac} />
      <Text size="xs" c="dimmed" ta="center">
        {label}
      </Text>
    </Stack>
  );
}

// Simulador "¿Y si...?" (What-If): permite mover los factores de riesgo
// modificables y ver, en vivo, cómo cambia el riesgo PREVENT respecto del
// basal del paciente. Cálculo 100% en el cliente con el motor ya validado
// (ckm/prevent), sin tocar el servidor ni persistir nada.
import { Badge, Button, Group, Paper, SimpleGrid, Slider, Stack, Switch, Text, ThemeIcon, Title } from '@mantine/core';
import { IconArrowDownRight, IconArrowRight, IconArrowUpRight, IconRefresh } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { computePrevent } from '../prevent';
import type { PreventInputs } from '../prevent';

export interface PreventSimulatorProps {
  /** Insumos PREVENT basales del paciente (de usePreventBaseline). */
  baseline: PreventInputs;
}

/** Variables modificables del simulador (las que el motor PREVENT usa). */
interface SimState {
  systolicBP: number;
  nonHdl: number; // mg/dL
  hdl: number; // mg/dL
  bmi: number; // kg/m²
  egfr: number; // mL/min/1.73m²
  diabetes: boolean;
  smoking: boolean;
  onAntihypertensive: boolean;
  onStatin: boolean;
}

/** Deriva el estado inicial del simulador desde los insumos basales. */
function baselineState(b: PreventInputs): SimState {
  const nonHdl = b.nonHdlCholesterol ?? Math.max(0, (b.totalCholesterol ?? 0) - b.hdl);
  return {
    systolicBP: Math.round(b.systolicBP),
    nonHdl: Math.round(nonHdl),
    hdl: Math.round(b.hdl),
    bmi: Math.round(b.bmi * 10) / 10,
    egfr: Math.round(b.egfr),
    diabetes: b.diabetes,
    smoking: b.smoking,
    onAntihypertensive: b.onAntihypertensive,
    onStatin: b.onStatin,
  };
}

/** Combina los insumos basales con los overrides del simulador. */
function toInputs(b: PreventInputs, s: SimState): PreventInputs {
  return {
    ...b,
    systolicBP: s.systolicBP,
    // Usamos no-HDL directo como única palanca de lípidos aterogénicos.
    nonHdlCholesterol: s.nonHdl,
    totalCholesterol: undefined,
    hdl: s.hdl,
    bmi: s.bmi,
    egfr: s.egfr,
    diabetes: s.diabetes,
    smoking: s.smoking,
    onAntihypertensive: s.onAntihypertensive,
    onStatin: s.onStatin,
  };
}

export function PreventSimulator(props: PreventSimulatorProps): JSX.Element {
  const { baseline } = props;
  const initial = useMemo(() => baselineState(baseline), [baseline]);
  const [sim, setSim] = useState<SimState>(initial);

  const basalScores = useMemo(() => computePrevent(toInputs(baseline, initial)), [baseline, initial]);
  const simScores = useMemo(() => computePrevent(toInputs(baseline, sim)), [baseline, sim]);

  const set = <K extends keyof SimState>(key: K, value: SimState[K]): void => setSim((s) => ({ ...s, [key]: value }));
  const reset = (): void => setSim(initial);

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm" wrap="nowrap">
          <Title order={4}>Riesgo proyectado</Title>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconRefresh size={16} />}
            onClick={reset}
            disabled={JSON.stringify(sim) === JSON.stringify(initial)}
          >
            Volver al basal
          </Button>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <RiskCard label="ASCVD 10 años" basal={basalScores?.ascvd10y} sim={simScores?.ascvd10y} />
          <RiskCard label="Insuficiencia cardíaca 10 años" basal={basalScores?.hf10y} sim={simScores?.hf10y} />
          <RiskCard label="ECV total 30 años" basal={basalScores?.cvdTotal30y} sim={simScores?.cvdTotal30y} />
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="md">
        <Title order={5} mb="md">
          Factores modificables
        </Title>
        <Stack gap="lg">
          <SliderRow
            label="Presión arterial sistólica"
            unit="mmHg"
            value={sim.systolicBP}
            min={80}
            max={220}
            step={1}
            onChange={(v) => set('systolicBP', v)}
          />
          <SliderRow
            label="Colesterol no-HDL"
            unit="mg/dL"
            value={sim.nonHdl}
            min={50}
            max={300}
            step={1}
            onChange={(v) => set('nonHdl', v)}
          />
          <SliderRow
            label="Colesterol HDL"
            unit="mg/dL"
            value={sim.hdl}
            min={20}
            max={100}
            step={1}
            onChange={(v) => set('hdl', v)}
          />
          <SliderRow
            label="Índice de masa corporal"
            unit="kg/m²"
            value={sim.bmi}
            min={15}
            max={50}
            step={0.1}
            precision={1}
            onChange={(v) => set('bmi', v)}
          />
          <SliderRow
            label="Filtrado glomerular (eGFR)"
            unit="mL/min/1.73m²"
            value={sim.egfr}
            min={5}
            max={120}
            step={1}
            onChange={(v) => set('egfr', v)}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Switch
              label="Diabetes"
              checked={sim.diabetes}
              onChange={(e) => set('diabetes', e.currentTarget.checked)}
            />
            <Switch label="Fumador" checked={sim.smoking} onChange={(e) => set('smoking', e.currentTarget.checked)} />
            <Switch
              label="Tratamiento antihipertensivo"
              checked={sim.onAntihypertensive}
              onChange={(e) => set('onAntihypertensive', e.currentTarget.checked)}
            />
            <Switch
              label="Tratamiento con estatina"
              checked={sim.onStatin}
              onChange={(e) => set('onStatin', e.currentTarget.checked)}
            />
          </SimpleGrid>
        </Stack>
      </Paper>
    </Stack>
  );
}

function SliderRow(props: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  precision?: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm">{props.label}</Text>
        <Text size="sm" fw={600}>
          {props.precision ? props.value.toFixed(props.precision) : props.value} {props.unit}
        </Text>
      </Group>
      <Slider
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={props.onChange}
        label={(v) => (props.precision ? v.toFixed(props.precision) : v)}
      />
    </Stack>
  );
}

function RiskCard(props: { label: string; basal?: number; sim?: number }): JSX.Element {
  const { basal, sim } = props;
  const delta = basal !== undefined && sim !== undefined ? Math.round((sim - basal) * 10) / 10 : undefined;
  const dir = delta === undefined || Math.abs(delta) < 0.05 ? 'flat' : delta < 0 ? 'down' : 'up';
  const color = dir === 'down' ? 'teal' : dir === 'up' ? 'red' : 'gray';
  const Icon = dir === 'down' ? IconArrowDownRight : dir === 'up' ? IconArrowUpRight : IconArrowRight;

  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap={6} align="center">
        <Text size="xs" c="dimmed" ta="center">
          {props.label}
        </Text>
        <Group gap="xs" align="baseline" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {basal !== undefined ? `${basal}%` : '—'}
          </Text>
          <IconArrowRight size={14} color="var(--mantine-color-dimmed)" />
          <Text fz={28} fw={700} c={color} lh={1.1}>
            {sim !== undefined ? `${sim}%` : '—'}
          </Text>
        </Group>
        {delta !== undefined && (
          <Badge
            color={color}
            variant="light"
            leftSection={
              <ThemeIcon size={14} color={color} variant="transparent">
                <Icon size={14} />
              </ThemeIcon>
            }
          >
            {delta > 0 ? '+' : ''}
            {delta} pts
          </Badge>
        )}
      </Stack>
    </Paper>
  );
}

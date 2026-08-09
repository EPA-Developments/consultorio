// Página del simulador "¿Y si...?" (What-If) de un paciente. Carga el paciente,
// reúne sus insumos PREVENT basales (usePreventBaseline) y muestra el simulador
// o un mensaje con los datos faltantes si no alcanzan para calcular.
import { Alert, Anchor, Group, List, Paper, Stack, Text, Title } from '@mantine/core';
import { formatHumanName } from '@medplum/core';
import type { HumanName, Patient } from '@medplum/fhirtypes';
import { Loading, useMedplum } from '@medplum/react';
import { IconAlertTriangle, IconArrowLeft } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';
import { CKMStageBadge } from '../ckm/components/CKMStageBadge';
import { PreventSimulator } from '../ckm/components/PreventSimulator';
import { getCKMStage } from '../ckm/extensions';
import { usePreventBaseline } from '../ckm/hooks/usePreventBaseline';
import { ErrorCarga } from '../components/ErrorCarga';

export function SimulatorPage(): JSX.Element {
  const medplum = useMedplum();
  const { patientId } = useParams();
  const [patient, setPatient] = useState<Patient>();

  useEffect(() => {
    if (patientId) {
      medplum.readResource('Patient', patientId).then(setPatient).catch(console.error);
    }
  }, [medplum, patientId]);

  const baseline = usePreventBaseline(patient);

  if (!patient || baseline.loading) {
    return <Loading />;
  }

  const stage = getCKMStage(patient);

  return (
    <Paper shadow="xs" m="md" p="md" maw={900} mx="auto">
      <Stack gap="md">
        <Stack gap={4}>
          <Anchor component={Link} to={`/Patient/${patient.id}`} size="sm">
            <Group gap={4} wrap="nowrap">
              <IconArrowLeft size={14} />
              Volver al chart
            </Group>
          </Anchor>
          <Group justify="space-between" wrap="nowrap">
            <Title order={3}>Simulador ¿Y si...?</Title>
            {stage !== undefined && <CKMStageBadge stage={stage} size="md" />}
          </Group>
          <Text c="dimmed" size="sm">
            {patient.name?.[0] ? formatHumanName(patient.name[0] as HumanName) : 'Paciente'} · proyección de riesgo
            cardiovascular (ecuaciones PREVENT, AHA). Moviendo los factores modificables se ve el impacto estimado sobre
            el riesgo a 10 y 30 años.
          </Text>
        </Stack>

        {baseline.error ? (
          <ErrorCarga que="los datos basales del paciente" />
        ) : baseline.inputs ? (
          <PreventSimulator baseline={baseline.inputs} />
        ) : (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Datos insuficientes">
            <Text size="sm" mb="xs">
              No hay datos suficientes para calcular el riesgo PREVENT de este paciente. Falta cargar:
            </Text>
            <List size="sm">
              {baseline.missing.map((m) => (
                <List.Item key={m}>{m}</List.Item>
              ))}
            </List>
          </Alert>
        )}

        <Text size="xs" c="dimmed">
          Herramienta de apoyo educativa. Las proyecciones son estimaciones poblacionales (Khan et al., Circulation
          2024) y no reemplazan el juicio clínico.
        </Text>
      </Stack>
    </Paper>
  );
}

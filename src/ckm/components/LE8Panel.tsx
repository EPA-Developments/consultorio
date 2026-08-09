// Tab "Salud CV · LE8" de la ficha del paciente. Combina los 4 componentes
// clínicos (Observations, Etapa B) con los 4 conductuales (QuestionnaireResponse
// del paciente, Etapa C) y calcula Life's Essential 8 (Etapa A). El compuesto
// solo se muestra con los 8 componentes; con datos parciales quedan los
// sub-scores y la lista de faltantes. Solo lectura.
import { Badge, Group, Loader, Paper, RingProgress, Stack, Table, Text, Title } from '@mantine/core';
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { ErrorCarga } from '../../components/ErrorCarga';
import { useLE8ClinicalInputs } from '../hooks/useLE8ClinicalInputs';
import { useLE8QuestionnaireInputs } from '../hooks/useLE8QuestionnaireInputs';
import { computeLE8, LE8_LABELS, LE8_ORDER, le8Category } from '../le8';
import type { LE8ComponentKey, LE8Inputs } from '../le8';

// De dónde sale cada componente, para que el equipo sepa qué falta cargar.
const SOURCE: Record<LE8ComponentKey, string> = {
  diet: 'Cuestionario del paciente (MEPA)',
  physicalActivity: 'Cuestionario del paciente (Exercise Vital Sign)',
  nicotine: 'Cuestionario del paciente (tabaco)',
  sleep: 'Cuestionario del paciente (PSQI)',
  bmi: 'Laboratorio / Observación',
  lipids: 'Laboratorio / Observación',
  glucose: 'Laboratorio / Observación',
  bloodPressure: 'Laboratorio / Observación',
};

export function LE8Panel(props: { patient: Patient }): JSX.Element {
  const clinical = useLE8ClinicalInputs(props.patient);
  const behavioral = useLE8QuestionnaireInputs(props.patient);

  if (clinical.loading || behavioral.loading) {
    return <Loader m="xl" />;
  }
  // Con la lectura caída, la rueda pintaría los 4 componentes clínicos como
  // "Sin dato" — un compuesto incompleto inventado, no observado.
  if (clinical.error) {
    return <ErrorCarga que="los componentes clínicos de LE8" />;
  }

  const inputs: LE8Inputs = { ...clinical.inputs, ...behavioral.inputs };
  const result = computeLE8(inputs);
  const byKey = new Map(result.components.map((c) => [c.key, c]));

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Title order={4}>Salud cardiovascular — Life&apos;s Essential 8</Title>
        <Text c="dimmed" size="sm">
          8 componentes (0–100). El compuesto es el promedio simple y solo se muestra con los 8 presentes. AHA,
          Lloyd-Jones 2022.
        </Text>
      </Stack>

      <Group gap="xl" align="center">
        {/* Rueda estilo AHA: 8 sectores iguales, uno por componente, coloreado
            por su estado (gris si falta). El centro muestra el compuesto (si 8/8)
            o cuántos componentes hay. */}
        <RingProgress
          size={170}
          thickness={16}
          sections={LE8_ORDER.map((key) => {
            const component = byKey.get(key);
            return {
              value: 12.5,
              color: component ? le8Category(component.score).color : 'gray.3',
              tooltip: `${LE8_LABELS[key]}: ${component ? `${component.score}/100` : 'sin dato'}`,
            };
          })}
          label={
            <Stack gap={0} align="center">
              {result.complete && result.composite !== undefined ? (
                <>
                  <Text fw={700} size="xl">
                    {result.composite}
                  </Text>
                  <Text size="xs" c="dimmed">
                    / 100
                  </Text>
                </>
              ) : (
                <>
                  <Text fw={700} size="lg">
                    {result.components.length}/8
                  </Text>
                  <Text size="xs" c="dimmed">
                    componentes
                  </Text>
                </>
              )}
            </Stack>
          }
        />
        {result.complete && result.compositeCategory ? (
          <Stack gap={4}>
            <Badge color={result.compositeCategory.color} variant="light" size="lg">
              {result.compositeCategory.label}
            </Badge>
            <Text size="sm" c="dimmed">
              Salud cardiovascular global
            </Text>
            <Text size="xs" c="dimmed">
              Cada sector es uno de los 8 componentes.
            </Text>
          </Stack>
        ) : (
          <Stack gap={4} maw={360}>
            <Text size="sm" fw={600}>
              Compuesto incompleto
            </Text>
            <Text size="sm" c="dimmed">
              El puntaje global se calcula con los 8 componentes. Faltan:{' '}
              {result.missing.map((k) => LE8_LABELS[k]).join(', ')}.
            </Text>
          </Stack>
        )}
      </Group>

      <Table verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Componente</Table.Th>
            <Table.Th>Puntaje</Table.Th>
            <Table.Th>Estado</Table.Th>
            <Table.Th>Fuente</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {LE8_ORDER.map((key) => {
            const component = byKey.get(key);
            return (
              <Table.Tr key={key}>
                <Table.Td>
                  <Text size="sm">{LE8_LABELS[key]}</Text>
                </Table.Td>
                <Table.Td>
                  {component ? (
                    <Text size="sm">{component.score} / 100</Text>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Sin dato
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {component ? (
                    <Badge color={le8Category(component.score).color} variant="light" style={{ cursor: 'default' }}>
                      {le8Category(component.score).label}
                    </Badge>
                  ) : (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {SOURCE[key]}
                  </Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>

      {(behavioral.psqi?.global !== undefined || behavioral.mepaScore !== undefined) && (
        <Paper withBorder p="sm" radius="sm">
          <Group gap="xl">
            {behavioral.psqi?.global !== undefined && (
              <Text size="sm">
                <Text span fw={600}>
                  PSQI global:
                </Text>{' '}
                {behavioral.psqi.global} / 21{' '}
                <Text span c="dimmed">
                  (menor = mejor calidad)
                </Text>
              </Text>
            )}
            {behavioral.mepaScore !== undefined && (
              <Text size="sm">
                <Text span fw={600}>
                  MEPA:
                </Text>{' '}
                {behavioral.mepaScore} / 16
              </Text>
            )}
          </Group>
        </Paper>
      )}

      <Text size="xs" c="dimmed">
        Estado por componente: Alto ≥80 · Moderado 50–79 · Bajo &lt;50. La dieta (MEPA → nivel) usa un crosswalk
        provisional, a calibrar con el equipo médico. El ajuste por medicación de la presión se aplica solo si hay
        antihipertensivos registrados. Los componentes conductuales (sueño, dieta, actividad, tabaco) provienen de los
        cuestionarios que carga el paciente.
      </Text>
    </Stack>
  );
}

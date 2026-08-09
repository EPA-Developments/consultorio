// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Container, Group, Text, Title } from '@mantine/core';
import { getDisplayString } from '@medplum/core';
import type { Encounter, Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';

interface EncounterHeaderProps {
  encounter: Encounter;
  patient?: Patient;
}

export function EncounterHeader({ encounter, patient }: EncounterHeaderProps): JSX.Element {
  const displayDate = getDisplayDate(encounter?.period?.start);

  return (
    <Group>
      <Container m="sm">
        <Text size="sm" c="dimmed">
          Tipo de atención
        </Text>
        <Title order={5}>{encounter.type?.[0].coding?.[0].display ?? 'Sin tipo'}</Title>
      </Container>
      <Container m="sm">
        <Text size="sm" c="dimmed">
          Paciente
        </Text>
        <Title order={5}>{patient ? getDisplayString(patient) : '—'}</Title>
      </Container>
      <Container m="sm">
        <Text size="sm" c="dimmed">
          Fecha
        </Text>
        <Title order={5}>{displayDate}</Title>
      </Container>
    </Group>
  );
}

/**
 * Fecha clínica de la evolución, sin aritmética de zona horaria.
 *
 * La versión del template hacía `getDate() + 1` para compensar que un string
 * fecha-sin-hora se parsea como medianoche UTC (que en Argentina es el día
 * anterior). La compensación fabricaba fechas imposibles en los bordes: una
 * evolución del 2026-09-01 se mostraba como "2026-08-32". La fecha que declaró
 * el médico está en los primeros 10 caracteres del string; se usa esa, sin
 * pasar por Date.
 */
function getDisplayDate(isoStringDate?: string): string {
  const iso = isoStringDate ?? new Date().toISOString();
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

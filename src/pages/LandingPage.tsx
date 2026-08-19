// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Stack, Text, Title } from '@mantine/core';
import { Document } from '@medplum/react';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { BRAND } from '../brand';
import { BrandLogo } from '../components/BrandLogo';

export function LandingPage(): JSX.Element {
  return (
    <Document width={520}>
      <Stack align="center" gap="md">
        <BrandLogo height={72} />
        <Title order={1} fz={32} ta="center">
          {BRAND.name}
        </Title>
        <Text ta="center" c="dimmed" maw={440}>
          {BRAND.appName}: el espacio de trabajo del profesional. Historia clínica, riesgo cardiovascular (ecuaciones
          PREVENT), estadío Cardio-Reno-Metabólico (CKM), órdenes de laboratorio y prescripción por nombre genérico,
          sobre una base FHIR (Medplum).
        </Text>
        <Button component={Link} to="/signin" size="md" radius="xl">
          Ingresar
        </Button>
      </Stack>
    </Document>
  );
}

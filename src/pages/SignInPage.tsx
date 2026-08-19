// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Group, Text, Title } from '@mantine/core';
import { SignInForm } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { BRAND } from '../brand';
import { BrandLogo } from '../components/BrandLogo';
import { getConfig } from '../config';

export function SignInPage(): JSX.Element {
  const navigate = useNavigate();
  return (
    <SignInForm
      googleClientId={getConfig().googleClientId}
      onSuccess={() => navigate('/')?.catch(console.error)}
      clientId={getConfig().clientId}
    >
      <Group justify="center">
        <BrandLogo height={56} />
      </Group>
      <Title ta="center" order={2} mt="sm">
        {BRAND.appName}
      </Title>
      <Text ta="center" size="sm" c="dimmed">
        {BRAND.tagline}
      </Text>
      <Text ta="center" size="xs" c="dimmed" mt="xl">
        {BRAND.name}
      </Text>
    </SignInForm>
  );
}

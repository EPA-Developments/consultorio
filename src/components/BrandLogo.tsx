// Logo de marca. Usa el archivo public/logo.png (la imagen exacta de la marca);
// si todavía no está, cae a un wordmark para que la UI nunca muestre una imagen
// rota. Reemplaza al <Logo> de Medplum en header, login y landing.
import { Text } from '@mantine/core';
import { useState } from 'react';
import type { JSX } from 'react';
import { BRAND } from '../brand';

export interface BrandLogoProps {
  /** Alto en px (el ancho se ajusta solo). */
  height?: number;
}

export function BrandLogo(props: BrandLogoProps): JSX.Element {
  const { height = 28 } = props;
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Text
        component="span"
        fw={700}
        fz={Math.round(height * 0.52)}
        style={{ lineHeight: 1, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}
      >
        <Text component="span" inherit c="copper.7">
          {BRAND.wordmarkLead}
        </Text>
        <Text component="span" inherit c="dimmed" fw={400} px={6}>
          |
        </Text>
        <Text component="span" inherit c="dark.5">
          {BRAND.wordmarkTail}
        </Text>
      </Text>
    );
  }

  return (
    <img
      src="/logo.png"
      alt={BRAND.name}
      style={{ display: 'block', height, width: 'auto', objectFit: 'contain' }}
      onError={() => setFailed(true)}
    />
  );
}

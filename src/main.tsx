// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider, createTheme } from '@mantine/core';
import type { MantineColorsTuple } from '@mantine/core';
import '@mantine/core/styles.css';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react';
import '@medplum/react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { getConfig } from './config';

const medplum = new MedplumClient({
  onUnauthenticated: () => (window.location.href = '/'),
  baseUrl: getConfig().baseUrl,
});

// Paleta de marca: cobre como acento sobre una base neutra/clínica.
// Escala de 10 tonos (claro -> oscuro) para Mantine.
const copper: MantineColorsTuple = [
  '#fdf4ec',
  '#f1e0d1',
  '#e3c4a6',
  '#d5a677',
  '#ca8b4f',
  '#c37a35',
  '#bf7029',
  '#a85f21',
  '#934f1a',
  '#7d4111',
];

const theme = createTheme({
  primaryColor: 'copper',
  // Tono más profundo en claro: mejor contraste del texto blanco en botones.
  primaryShade: { light: 7, dark: 5 },
  colors: { copper },
  defaultRadius: 'md',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  headings: {
    fontWeight: '600',
    sizes: {
      h1: {
        fontSize: '1.125rem',
        fontWeight: '600',
        lineHeight: '2.0',
      },
    },
  },
  fontSizes: {
    xs: '0.6875rem',
    sm: '0.875rem',
    md: '0.875rem',
    lg: '1.0rem',
    xl: '1.125rem',
  },
});

const container = document.getElementById('root') as HTMLDivElement;
const root = createRoot(container);
root.render(
  <StrictMode>
    <BrowserRouter>
      <MedplumProvider medplum={medplum}>
        <MantineProvider theme={theme}>
          <Notifications />
          <App />
        </MantineProvider>
      </MedplumProvider>
    </BrowserRouter>
  </StrictMode>
);

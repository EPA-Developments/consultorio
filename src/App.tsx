// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { AppShell, ErrorBoundary, Loading, useMedplum, useMedplumProfile } from '@medplum/react';
import {
  IconClipboardHeart,
  IconClipboardList,
  IconFlask,
  IconHeartRateMonitor,
  IconHome,
  IconPill,
  IconUser,
} from '@tabler/icons-react';
import { Suspense } from 'react';
import type { JSX } from 'react';
import { Route, Routes } from 'react-router';
import { BrandLogo } from './components/BrandLogo';
import { HomePage } from './home/components/HomePage';
import { BiomarkerPanelPage } from './pages/BiomarkerPanelPage';
import { CKMDashboard } from './pages/CKMDashboard';
import { EncounterPage } from './pages/EncounterPage';
import { SDOHForm } from './pages/SDOHForm';
import { SimulatorPage } from './pages/SimulatorPage';
import { LandingPage } from './pages/LandingPage';
import { LaboratorioPage } from './pages/LaboratorioPage';
import { PatientPage } from './pages/PatientPage';
import { PrescripcionesPage } from './pages/PrescripcionesPage';
import { ResourcePage } from './pages/ResourcePage';
import { SearchPage } from './pages/SearchPage';
import { SignInPage } from './pages/SignInPage';
import { UploadDataPage } from './pages/UploadDataPage';

export function App(): JSX.Element | null {
  const medplum = useMedplum();
  const profile = useMedplumProfile();

  if (medplum.isLoading()) {
    return null;
  }

  return (
    <AppShell
      logo={<BrandLogo height={26} />}
      menus={[
        {
          title: 'Inicio',
          links: [{ icon: <IconHome />, label: 'Mi tablero', href: '/' }],
        },
        {
          title: 'CKM',
          links: [{ icon: <IconHeartRateMonitor />, label: 'Panel CKM', href: '/ckm' }],
        },
        {
          title: 'Historias clínicas',
          links: [{ icon: <IconUser />, label: 'Pacientes', href: '/Patient' }],
        },
        {
          title: 'Evoluciones',
          links: [
            { icon: <IconClipboardList />, label: 'Todas las evoluciones', href: '/Encounter' },
            {
              icon: <IconClipboardHeart />,
              label: 'Mis evoluciones',
              href: `/Encounter?participant=Practitioner/${profile?.id}`,
            },
          ],
        },
        {
          title: 'Prescripciones',
          links: [{ icon: <IconPill />, label: 'Recetas', href: '/prescripciones' }],
        },
        {
          title: 'Laboratorio',
          links: [{ icon: <IconFlask />, label: 'Órdenes de laboratorio', href: '/laboratorio' }],
        },
      ]}
    >
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={profile ? <HomePage /> : <LandingPage />} />
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/ckm" element={<CKMDashboard />} />
            <Route path="/prescripciones" element={<PrescripcionesPage />} />
            <Route path="/prescripciones/:patientId" element={<PrescripcionesPage />} />
            <Route path="/laboratorio" element={<LaboratorioPage />} />
            <Route path="/laboratorio/:patientId" element={<LaboratorioPage />} />
            <Route path="/ckm/biomarkers/:patientId" element={<BiomarkerPanelPage />} />
            <Route path="/ckm/sdoh/:patientId" element={<SDOHForm />} />
            <Route path="/ckm/simulator/:patientId" element={<SimulatorPage />} />
            <Route path="/Patient/:id">
              <Route index element={<PatientPage />} />
              <Route path="*" element={<PatientPage />} />
            </Route>
            <Route path="/:resourceType/:id">
              <Route index element={<ResourcePage />} />
              <Route path="*" element={<ResourcePage />} />
            </Route>
            <Route path="/:resourceType" element={<SearchPage />} />
            <Route path="/Encounter/:id">
              <Route index element={<EncounterPage />} />
              <Route path="*" element={<EncounterPage />} />
            </Route>
            <Route path="/upload/:dataType" element={<UploadDataPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

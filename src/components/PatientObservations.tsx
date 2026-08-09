// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Loader, Menu } from '@mantine/core';
import { formatSearchQuery, Operator } from '@medplum/core';
import type { SearchRequest } from '@medplum/core';
import type { Coding, Patient } from '@medplum/fhirtypes';
import { SearchControl } from '@medplum/react';
import { IconMenu2 } from '@tabler/icons-react';
import { Suspense, useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { ObservationGraph } from './graphs/ObservationGraph';
import { measurementStyles } from './graphs/measurement-constants';

interface PatientObservationsProps {
  patient: Patient;
}

const LOINC_SYSTEM = 'http://loinc.org';

// Menú: "Todas" + todas las mediciones definidas en measurementStyles (CKM).
const MEASUREMENTS = Object.values(measurementStyles);
const TABS: [string, string][] = [
  ['all', 'Todas las observaciones'],
  ...MEASUREMENTS.map((m) => [m.id, m.title] as [string, string]),
];

export function PatientObservations(props: PatientObservationsProps): JSX.Element {
  const navigate = useNavigate();
  const [currentTab, setCurrentTab] = useState<[string, string]>(TABS[0]);

  const search: SearchRequest = {
    resourceType: 'Observation',
    filters: [{ code: 'patient', operator: Operator.EQUALS, value: `Patient/${props.patient.id}` }],
    fields: ['status', 'code', 'focus'],
  };

  const measurement = measurementStyles[currentTab[0]];
  const coding: Coding | undefined = measurement
    ? // display: el título humano, no el id — termina en el mensaje de 'sin registros'
      { system: LOINC_SYSTEM, code: measurement.code, display: measurement.title }
    : undefined;

  return (
    <div>
      <Menu>
        <Menu.Target>
          <Button leftSection={<IconMenu2 />} variant="default">
            {currentTab[1]}
          </Button>
        </Menu.Target>
        <Menu.Dropdown mah={400} style={{ overflowY: 'auto' }}>
          {TABS.map((tab) => (
            <Menu.Item key={tab[0]} onClick={() => setCurrentTab(tab)}>
              {tab[1]}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      <div style={{ marginTop: 16 }}>
        {currentTab[0] === 'all' || !coding ? (
          <SearchControl
            search={search}
            hideFilters={true}
            hideToolbar={true}
            onClick={(e) => navigate(`/${e.resource.resourceType}/${e.resource.id}`)?.catch(console.error)}
            onChange={(e) => {
              navigate(`/${search.resourceType}${formatSearchQuery(e.definition)}`)?.catch(console.error);
            }}
          />
        ) : (
          <Suspense fallback={<Loader m="md" />}>
            <ObservationGraph code={coding} patient={props.patient} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

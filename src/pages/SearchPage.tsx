// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Paper } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { formatSearchQuery, parseSearchRequest } from '@medplum/core';
import type { SearchRequest, SortRule } from '@medplum/core';
import type { UserConfiguration } from '@medplum/fhirtypes';
import { Loading, SearchControl, useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CKMPatientList } from '../ckm/components/CKMPatientList';
import { CreateEncounter } from '../components/actions/CreateEncounter';
import { parseStoredSearch, serializeSearchForStorage } from '../security/search-storage';
import type { StorableSearch } from '../security/search-storage';
import classes from './SearchPage.module.css';

export function SearchPage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState<SearchRequest>();
  const [opened, handlers] = useDisclosure(false);

  useEffect(() => {
    const parsedSearch = parseSearchRequest(location.pathname + location.search);

    if (!parsedSearch.resourceType) {
      // If there is no search, go to the Encounter search page by default
      navigate('/Encounter')?.catch(console.error);
      return;
    }

    // Populate the search with default values as necessary
    const populatedSearch = addSearchValues(parsedSearch, medplum.getUserConfiguration());

    if (
      // If the current url matches the search, set the search, otherwise navigate to the correct url
      location.pathname === `/${populatedSearch.resourceType}` &&
      location.search === formatSearchQuery(populatedSearch)
    ) {
      saveLastSearch(populatedSearch);
      setSearch(populatedSearch);
    } else {
      navigate(`/${populatedSearch.resourceType}${formatSearchQuery(populatedSearch)}`)?.catch(console.error);
    }
  }, [medplum, navigate, location]);

  if (!search?.resourceType || !search.fields || search.fields.length === 0) {
    return <Loading />;
  }

  return (
    <Paper shadow="xs" m="md" p="xs" className={classes.paper}>
      <CreateEncounter opened={opened} handlers={handlers} />
      {search.resourceType === 'Patient' ? (
        <CKMPatientList />
      ) : (
        <SearchControl
          checkboxesEnabled={false}
          search={search}
          onClick={(e) => navigate(`/${e.resource.resourceType}/${e.resource.id}`)?.catch(console.error)}
          onAuxClick={(e) => window.open(`/${e.resource.resourceType}/${e.resource.id}`, '_blank')}
          onChange={(e) => {
            navigate(`/${search.resourceType}${formatSearchQuery(e.definition)}`)?.catch(console.error);
          }}
          hideFilters={true}
          hideToolbar={search.resourceType !== 'Encounter'}
          onNew={handlers.open}
        />
      )}
    </Paper>
  );
}

function addSearchValues(search: SearchRequest, config: UserConfiguration | undefined): SearchRequest {
  const resourceType = search.resourceType || getDefaultResourceType(config);
  const fields = search.fields ?? getDefaultFields(search.resourceType);
  // Los filtros NO se restauran desde el navegador: no se persisten porque
  // pueden contener datos del paciente (ver security/search-storage.ts).
  const filters = search.filters;
  const sortRules = search.sortRules ?? getDefaultSortRules(resourceType);

  return {
    ...search,
    resourceType,
    fields,
    filters,
    sortRules,
  };
}

function getDefaultResourceType(config: UserConfiguration | undefined): string {
  return (
    localStorage.getItem('defaultResourceType') ??
    config?.option?.find((o) => o.id === 'defaultResourceType')?.valueString ??
    'Task'
  );
}

function getDefaultSortRules(resourceType: string): SortRule[] {
  const lastSearch = getLastSearch(resourceType);
  if (lastSearch?.sortRules) {
    return lastSearch.sortRules;
  }
  return [{ code: '_lastUpdated', descending: true }];
}

// La búsqueda persistida se sanea al leer Y al escribir: nunca guarda filtros,
// porque pueden contener datos del paciente (apellido, DNI, referencias) y
// localStorage sobrevive al cierre de sesión en una máquina compartida.
// Ver src/security/search-storage.ts.
function getLastSearch(resourceType: string): StorableSearch | undefined {
  return parseStoredSearch(localStorage.getItem(resourceType + '-defaultSearch'));
}

function saveLastSearch(search: SearchRequest): void {
  localStorage.setItem('defaultResourceType', search.resourceType);
  localStorage.setItem(search.resourceType + '-defaultSearch', serializeSearchForStorage(search));
}

function getDefaultFields(resourceType: string): string[] {
  switch (resourceType) {
    case 'Encounter':
      return ['class', 'type', 'subject', 'period'];
    case 'Patient':
      return ['name', 'gender', 'birthDate', '_lastUpdated'];
    case 'Practitioner':
      return ['name', '_lastUpdated'];
    default:
      return ['_id', '_lastUpdated'];
  }
}

// Panel "Datos Argentina" del chart del paciente: edita DNI, CUIL/CUIT y
// género autopercibido (Ley 26.743) sobre el recurso Patient, usando los
// `system` y la extensión definidos en ckm/argentina. Reemplaza la sección de
// raza/etnia de US Core, no aplicable en Argentina.
import { Button, Group, Paper, Select, Stack, TextInput, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconFlag } from '@tabler/icons-react';
import { useState } from 'react';
import type { JSX } from 'react';
import {
  CUIL_SYSTEM,
  DNI_SYSTEM,
  GENDER_IDENTITY_OPTIONS,
  getGenderIdentity,
  getIdentifierValue,
  setGenderIdentity,
  setIdentifierValue,
} from '../argentina';

export interface DatosArgentinaProps {
  patient: Patient;
  onChange?: (patient: Patient) => void;
}

export function DatosArgentina(props: DatosArgentinaProps): JSX.Element {
  const medplum = useMedplum();
  const { patient } = props;
  const [dni, setDni] = useState(getIdentifierValue(patient, DNI_SYSTEM) ?? '');
  const [cuil, setCuil] = useState(getIdentifierValue(patient, CUIL_SYSTEM) ?? '');
  const [gender, setGender] = useState(getGenderIdentity(patient) ?? '');
  const [saving, setSaving] = useState(false);

  const dirty =
    dni !== (getIdentifierValue(patient, DNI_SYSTEM) ?? '') ||
    cuil !== (getIdentifierValue(patient, CUIL_SYSTEM) ?? '') ||
    gender !== (getGenderIdentity(patient) ?? '');

  async function save(): Promise<void> {
    setSaving(true);
    try {
      let next: Patient = { ...patient };
      next.identifier = setIdentifierValue(next, DNI_SYSTEM, dni, 'DNI');
      next = { ...next, identifier: setIdentifierValue(next, CUIL_SYSTEM, cuil, 'CUIL') };
      next = { ...next, extension: setGenderIdentity(next, gender) };
      const updated = await medplum.updateResource(next);
      props.onChange?.(updated);
      showNotification({ color: 'green', message: 'Datos de Argentina guardados' });
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group gap="xs" wrap="nowrap">
          <IconFlag size={18} />
          <Title order={4}>Datos Argentina</Title>
        </Group>
        <TextInput label="DNI" placeholder="30123456" value={dni} onChange={(e) => setDni(e.currentTarget.value)} />
        <TextInput
          label="CUIL / CUIT"
          placeholder="20-30123456-3"
          value={cuil}
          onChange={(e) => setCuil(e.currentTarget.value)}
        />
        <Select
          label="Género autopercibido (Ley 26.743)"
          placeholder="Seleccionar"
          clearable
          data={GENDER_IDENTITY_OPTIONS.map((o) => ({ value: o.code, label: o.display }))}
          value={gender || null}
          onChange={(v) => setGender(v ?? '')}
        />
        <Group justify="flex-end">
          <Button onClick={() => void save()} loading={saving} disabled={!dirty} size="xs">
            Guardar
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

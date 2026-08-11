// Andamiaje compartido de las secciones clínicas de primer nivel
// (Prescripciones, Laboratorio): elegir el paciente → ver su contexto
// (identidad, cobertura) → trabajar. Cada sección aporta solo su contenido;
// el selector, el contexto y los estados de error son UNO para todas.
//
// La navegación preserva el query string (?preset=...), para que un deep-link
// del Portal sobreviva al paso de elegir paciente.
import { Badge, Button, Card, Group, Loader, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { formatHumanName } from '@medplum/core';
import type { Coverage, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconArrowLeft, IconSearch, IconUser } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CUIL_SYSTEMS, DNI_SYSTEM, getIdentifierValue, identifierIn } from '../ckm/argentina';
import { ageFromBirthDate } from '../ckm/clinical';
import { ErrorCarga } from './ErrorCarga';

export function EspacioPacientePage(props: {
  titulo: string;
  descripcion: string;
  /** Base de la ruta de la sección (ej. '/prescripciones'). */
  base: string;
  patientId?: string;
  children: (patient: Patient, cobertura: string | undefined) => ReactNode;
}): JSX.Element {
  return (
    <Stack gap="md" p="md" maw={960} mx="auto">
      <Stack gap={4}>
        <Title order={2}>{props.titulo}</Title>
        <Text c="dimmed" size="sm">
          {props.descripcion}
        </Text>
      </Stack>
      {props.patientId ? (
        <PacienteSeleccionado patientId={props.patientId} base={props.base}>
          {props.children}
        </PacienteSeleccionado>
      ) : (
        <SelectorPaciente base={props.base} />
      )}
    </Stack>
  );
}

function nombreDe(p: Patient): string {
  return p.name?.[0] ? formatHumanName(p.name[0]) : `Paciente ${p.id}`;
}

function sexoEs(gender: Patient['gender']): string | undefined {
  switch (gender) {
    case 'male':
      return 'Masculino';
    case 'female':
      return 'Femenino';
    case 'other':
      return 'Otro';
    default:
      return undefined;
  }
}

function fmtFecha(iso: string | undefined): string | undefined {
  if (!iso) {
    return undefined;
  }
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

// ── Selector de paciente ────────────────────────────────────────────────────

function SelectorPaciente(props: { base: string }): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<Patient[]>();
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResultados(undefined);
      setErrorBusqueda(false);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setBuscando(true);
      // Los dos hábitos de las recetadoras de referencia: por nombre o por
      // documento. Si lo tipeado es un número, se busca como identificador.
      const esNumero = /^[\d.\s]+$/.test(q);
      const params = esNumero ? { identifier: q.replace(/\D/g, '') } : { name: q };
      medplum
        .searchResources('Patient', { ...params, _count: '10' })
        .then((pacientes) => {
          if (!cancelled) {
            setResultados(pacientes);
            setErrorBusqueda(false);
          }
        })
        .catch((err) => {
          console.error(`${props.base}: error buscando pacientes`, err);
          if (!cancelled) {
            // Regla de la casa: una búsqueda caída no se disfraza de "sin
            // resultados" — invitaría a dar de alta un paciente duplicado.
            setErrorBusqueda(true);
            setResultados([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setBuscando(false);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [medplum, query, props.base]);

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <TextInput
          label="Elegir paciente"
          placeholder="Buscar por apellido, nombre o DNI"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          rightSection={buscando ? <Loader size="xs" /> : undefined}
          autoFocus
        />
        {errorBusqueda && <ErrorCarga que="la búsqueda de pacientes" />}
        {!errorBusqueda && resultados?.length === 0 && (
          <Text c="dimmed" size="sm">
            Sin resultados para «{query.trim()}». El alta de pacientes se hace desde Historias clínicas.
          </Text>
        )}
        {!errorBusqueda &&
          resultados?.map((p) => {
            const detalle = [
              getIdentifierValue(p, DNI_SYSTEM) ? `DNI ${getIdentifierValue(p, DNI_SYSTEM)}` : undefined,
              fmtFecha(p.birthDate) ? `Nac. ${fmtFecha(p.birthDate)}` : undefined,
              sexoEs(p.gender),
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <UnstyledButton
                key={p.id}
                onClick={() => navigate(`${props.base}/${p.id}${location.search}`)?.catch(console.error)}
              >
                <Card withBorder radius="sm" p="sm">
                  <Group gap="sm" wrap="nowrap">
                    <IconUser size={18} />
                    <div>
                      <Text fw={600} size="sm">
                        {nombreDe(p)}
                      </Text>
                      {detalle && (
                        <Text c="dimmed" size="xs">
                          {detalle}
                        </Text>
                      )}
                    </div>
                  </Group>
                </Card>
              </UnstyledButton>
            );
          })}
      </Stack>
    </Card>
  );
}

// ── Paciente seleccionado: contexto + contenido de la sección ───────────────

function coberturaTexto(c: Coverage): string {
  const plan = c.class?.find((k) => k.name || k.value);
  return [c.payor?.[0]?.display ?? 'Cobertura', plan?.name ?? plan?.value, c.subscriberId && `N° ${c.subscriberId}`]
    .filter(Boolean)
    .join(' · ');
}

function PacienteSeleccionado(props: {
  patientId: string;
  base: string;
  children: (patient: Patient, cobertura: string | undefined) => ReactNode;
}): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const location = useLocation();
  const [patient, setPatient] = useState<Patient>();
  const [errorPaciente, setErrorPaciente] = useState(false);
  const [coberturas, setCoberturas] = useState<Coverage[]>();
  const [errorCobertura, setErrorCobertura] = useState(false);

  const volver = (): void => {
    navigate(`${props.base}${location.search}`)?.catch(console.error);
  };

  useEffect(() => {
    let cancelled = false;
    setPatient(undefined);
    setErrorPaciente(false);
    setCoberturas(undefined);
    setErrorCobertura(false);
    medplum
      .readResource('Patient', props.patientId)
      .then((p) => {
        if (!cancelled) {
          setPatient(p);
        }
      })
      .catch((err) => {
        console.error(`${props.base}: error leyendo el paciente`, err);
        if (!cancelled) {
          setErrorPaciente(true);
        }
      });
    medplum
      .searchResources('Coverage', { beneficiary: `Patient/${props.patientId}`, _count: '5' })
      .then((cs) => {
        if (!cancelled) {
          setCoberturas(cs.filter((c) => c.status === 'active' || !c.status));
        }
      })
      .catch((err) => {
        console.error(`${props.base}: error leyendo la cobertura`, err);
        if (!cancelled) {
          setErrorCobertura(true);
          setCoberturas([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [medplum, props.patientId, props.base]);

  if (errorPaciente) {
    return (
      <Stack gap="sm">
        <ErrorCarga que="el paciente seleccionado" />
        <Group>
          <Button variant="light" leftSection={<IconArrowLeft size={14} />} onClick={volver}>
            Elegir otro paciente
          </Button>
        </Group>
      </Stack>
    );
  }
  if (!patient) {
    return <Loader size="sm" />;
  }

  const edad = ageFromBirthDate(patient.birthDate);
  const cuil = identifierIn(patient.identifier, CUIL_SYSTEMS);
  const datos = [
    getIdentifierValue(patient, DNI_SYSTEM) ? `DNI ${getIdentifierValue(patient, DNI_SYSTEM)}` : undefined,
    cuil ? `CUIL ${cuil}` : undefined,
    fmtFecha(patient.birthDate)
      ? `Nac. ${fmtFecha(patient.birthDate)}${Number.isFinite(edad) ? ` (${Math.floor(edad)} años)` : ''}`
      : undefined,
    sexoEs(patient.gender),
  ]
    .filter(Boolean)
    .join(' · ');
  const cobertura = coberturas?.length ? coberturaTexto(coberturas[0]) : undefined;

  return (
    <Stack gap="md">
      <Card withBorder radius="md" p="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Title order={3}>{nombreDe(patient)}</Title>
            {datos && (
              <Text c="dimmed" size="sm">
                {datos}
              </Text>
            )}
            <Group gap="xs" mt={6}>
              {errorCobertura ? (
                <Badge color="red" variant="light">
                  Cobertura: no se pudo leer
                </Badge>
              ) : coberturas === undefined ? (
                <Loader size="xs" />
              ) : cobertura ? (
                <Badge color="teal" variant="light">
                  {cobertura}
                </Badge>
              ) : (
                <Badge color="gray" variant="light">
                  Sin cobertura registrada
                </Badge>
              )}
            </Group>
          </div>
          <Button variant="light" size="xs" leftSection={<IconArrowLeft size={14} />} onClick={volver}>
            Cambiar paciente
          </Button>
        </Group>
      </Card>

      {props.children(patient, cobertura)}
    </Stack>
  );
}

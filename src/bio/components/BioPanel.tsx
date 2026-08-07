// Panel Bio: terapias de optimización, ordenadas por los tres ejes de la
// práctica, con el gate de seguridad corrido contra los antecedentes.
//
// SOLO LECTURA. No agenda, no registra sesiones y no indica nada: dice qué
// corresponde y qué no, y por qué.
//
// Los ejes (Rejuvenecer / Recuperar / Reparar) son la taxonomía de la práctica
// y sirven para navegar. NO son clave de decisión: lo que gatea es la
// medicalización y las contraindicaciones.
import { Accordion, Alert, Badge, Card, Chip, Group, List, Loader, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import type { Patient } from '@medplum/fhirtypes';
import { IconAlertTriangle, IconBan, IconClock, IconFlask, IconInfoCircle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { useBioSafety } from '../hooks/useBioSafety';
import { RESULTADO_LABELS } from '../safety';
import type { EvaluacionTerapia, HallazgoSeguridad } from '../safety';
import {
  EJE_LABELS,
  EVIDENCIA_LABELS,
  MEDICALIZACION_LABELS,
  sesionesDeLaSerie,
  SEVERIDAD_LABELS,
} from '../therapy-catalog';
import type { Eje } from '../therapy-catalog';

/** Situaciones del día que difieren una sesión sin ser antecedentes. */
const SITUACIONES = [
  { valor: 'fiebre', etiqueta: 'Fiebre o infección aguda' },
  { valor: 'alcohol', etiqueta: 'Alcohol o sustancias' },
];

export function BioPanel(props: { patient: Patient }): JSX.Element {
  const [situaciones, setSituaciones] = useState<string[]>([]);
  const { evaluaciones, loading } = useBioSafety(props.patient, situaciones);

  if (loading) {
    return <Loader m="xl" />;
  }
  if (!evaluaciones) {
    return (
      <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
        No se pudo evaluar el catálogo. Revisá que el paciente tenga la historia cargada.
      </Alert>
    );
  }

  const bloqueadas = evaluaciones.filter((e) => e.resultado === 'bloquear');

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Title order={4}>Panel Bio</Title>
        <Text c="dimmed" size="sm">
          Terapias de optimización, evaluadas contra los antecedentes del paciente. Solo lectura: no agenda ni registra
          sesiones.
        </Text>
      </Stack>

      <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
        <Text size="sm">
          Catálogo en <strong>borrador</strong>: ninguna terapia fue validada todavía por el equipo médico. Las
          contraindicaciones son una propuesta a revisar, no un protocolo vigente.
        </Text>
      </Alert>

      {/* Lo que difiere la sesión de hoy no es un antecedente: se marca acá. */}
      <Card withBorder radius="md" p="md">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb="xs">
          Situación del día
        </Text>
        <Chip.Group multiple value={situaciones} onChange={setSituaciones}>
          <Group gap="xs">
            {SITUACIONES.map((s) => (
              <Chip key={s.valor} value={s.valor} size="sm" variant="light">
                {s.etiqueta}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Text size="xs" c="dimmed" mt="xs">
          Difieren la sesión de hoy sin descartar al paciente del tratamiento.
        </Text>
      </Card>

      {bloqueadas.length > 0 && (
        <Card withBorder radius="md" p="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
          <Group gap="xs" mb="xs">
            <ThemeIcon color="red" variant="light" radius="md">
              <IconBan size={18} />
            </ThemeIcon>
            <Text fw={600}>
              {bloqueadas.length === 1 ? 'Una terapia no corresponde' : `${bloqueadas.length} terapias no corresponden`}
            </Text>
          </Group>
          <List size="sm" spacing={4}>
            {bloqueadas.map((e) => (
              <List.Item key={e.terapia.id}>
                <strong>{e.terapia.nombre}</strong> — {e.bloqueos.map((h) => h.motivo).join(', ')}
              </List.Item>
            ))}
          </List>
        </Card>
      )}

      {(['rejuvenecer', 'recuperar', 'reparar'] as Eje[]).map((eje) => {
        const delEje = evaluaciones.filter((e) => e.terapia.ejes.includes(eje));
        if (delEje.length === 0) {
          return null;
        }
        return (
          <Card withBorder radius="md" p="md" key={eje}>
            <Text fw={600} mb="xs">
              {EJE_LABELS[eje]}
            </Text>
            <Accordion variant="separated" chevronPosition="right">
              {delEje.map((e) => (
                <TerapiaItem key={e.terapia.id} evaluacion={e} />
              ))}
            </Accordion>
          </Card>
        );
      })}
    </Stack>
  );
}

function TerapiaItem(props: { evaluacion: EvaluacionTerapia }): JSX.Element {
  const { terapia, resultado, mensaje } = props.evaluacion;
  const estado = RESULTADO_LABELS[resultado];
  const medicalizacion = MEDICALIZACION_LABELS[terapia.medicalizacion];

  return (
    <Accordion.Item value={terapia.id}>
      <Accordion.Control>
        <Group justify="space-between" wrap="nowrap" pr="sm">
          <Stack gap={2}>
            <Text fw={600} size="sm">
              {terapia.nombre}
            </Text>
            <Text size="xs" c="dimmed">
              {terapia.nombreCompleto}
            </Text>
          </Stack>
          <Group gap={6} wrap="nowrap">
            <Badge size="sm" variant="light" color={medicalizacion.color}>
              {medicalizacion.label}
            </Badge>
            <Badge size="sm" variant="light" color={estado.color}>
              {estado.label}
            </Badge>
          </Group>
        </Group>
      </Accordion.Control>

      <Accordion.Panel>
        <Stack gap="sm">
          <Text size="sm">{mensaje}</Text>

          {terapia.alcancePendiente && (
            <Alert color="gray" variant="light" icon={<IconInfoCircle size={14} />} p="xs">
              <Text size="xs">{terapia.alcancePendiente}</Text>
            </Alert>
          )}

          <Hallazgos titulo="No corresponde" flags={props.evaluacion.bloqueos} color="red" />
          <Hallazgos titulo="Requiere evaluación" flags={props.evaluacion.evaluaciones} color="orange" />
          <Hallazgos titulo="Condicional" flags={props.evaluacion.condicionales} color="yellow" />
          <Hallazgos titulo="Difiere la sesión de hoy" flags={props.evaluacion.diferimientos} color="blue" />

          {props.evaluacion.tamizajePendiente.length > 0 && (
            <div>
              <Group gap={6} mb={4}>
                <IconFlask size={14} />
                <Text size="sm" fw={600}>
                  Tamizaje previo obligatorio
                </Text>
              </Group>
              <List size="sm" spacing={2}>
                {props.evaluacion.tamizajePendiente.map((t) => (
                  <List.Item key={t}>{t}</List.Item>
                ))}
              </List>
            </div>
          )}

          <div>
            <Text size="sm" fw={600} mb={4}>
              Indicaciones y su evidencia
            </Text>
            <Stack gap={4}>
              {terapia.indicaciones.map((i) => (
                <Group key={i.texto} gap={8} wrap="nowrap" align="flex-start">
                  <Badge size="xs" variant="light" color={EVIDENCIA_LABELS[i.evidencia].color} style={{ flexShrink: 0 }}>
                    {EVIDENCIA_LABELS[i.evidencia].label}
                  </Badge>
                  <Text size="sm">{i.texto}</Text>
                </Group>
              ))}
            </Stack>
          </div>

          <div>
            <Text size="sm" fw={600} mb={4}>
              Parámetros de la sesión
            </Text>
            <List size="sm" spacing={2}>
              {terapia.parametros.map((p) => (
                <List.Item key={p.clave}>
                  {p.etiqueta}
                  {p.unidad ? ` (${p.unidad})` : ''}
                  {p.sugerido !== undefined ? ` · sugerido ${p.sugerido}` : ''}
                  {p.nota && (
                    <Text size="xs" c="dimmed" fs="italic">
                      {p.nota}
                    </Text>
                  )}
                </List.Item>
              ))}
            </List>
          </div>

          <Group gap={6}>
            <IconClock size={14} />
            <Text size="sm">
              Serie de {terapia.serie.semanas} semanas ·{' '}
              {terapia.serie.frecuenciasSemanales
                .map((f) => `${f}/sem = ${sesionesDeLaSerie(terapia, f)} sesiones`)
                .join(' · ')}
            </Text>
          </Group>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function Hallazgos(props: { titulo: string; flags: HallazgoSeguridad[]; color: string }): JSX.Element | null {
  if (props.flags.length === 0) {
    return null;
  }
  return (
    <div>
      <Text size="sm" fw={600} c={props.color} mb={4}>
        {props.titulo}
      </Text>
      <Stack gap={6}>
        {props.flags.map((h) => (
          <div key={h.contraindicacion.id}>
            <Group gap={6} wrap="nowrap" align="flex-start">
              <Badge
                size="xs"
                variant="light"
                color={SEVERIDAD_LABELS[h.contraindicacion.severidad].color}
                style={{ flexShrink: 0 }}
              >
                {EVIDENCIA_LABELS[h.contraindicacion.evidencia].label}
              </Badge>
              <Text size="sm">{h.contraindicacion.texto}</Text>
            </Group>
            <Text size="xs" c="dimmed" ml={4}>
              En este paciente: {h.motivo}
            </Text>
            {h.contraindicacion.fuente && (
              <Text size="xs" c="dimmed" fs="italic" ml={4}>
                {h.contraindicacion.fuente}
              </Text>
            )}
          </div>
        ))}
      </Stack>
    </div>
  );
}

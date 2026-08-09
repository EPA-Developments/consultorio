// Home del médico: encabezado con saludo + KPIs + accesos rápidos, y una grilla
// de worklists accionables (bandeja / mi trabajo / seguimiento). Solo lectura;
// toda la lógica de datos vive en useHomeData + el módulo puro home-data.
import { Anchor, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useMedplumProfile } from '@medplum/react';
import {
  IconAlertCircle,
  IconCake,
  IconCalendarEvent,
  IconClipboardHeart,
  IconClipboardList,
  IconClipboardText,
  IconClipboardX,
  IconFlask,
  IconHeartRateMonitor,
  IconListCheck,
  IconReportMedical,
  IconSearch,
  IconUsers,
} from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { ErrorCarga } from '../../components/ErrorCarga';
import { useHomeData } from '../hooks/useHomeData';
import { WorklistCard } from './WorklistCard';

function greetingName(profile: ReturnType<typeof useMedplumProfile>): string {
  const name = profile && 'name' in profile ? profile.name?.[0] : undefined;
  return name ? [name.given?.join(' '), name.family].filter(Boolean).join(' ') : '';
}

export function HomePage(): JSX.Element {
  const profile = useMedplumProfile();
  const data = useHomeData();
  const name = greetingName(profile);

  return (
    <Stack gap="lg" p="md">
      <div>
        <Title order={3}>Hola{name ? `, ${name}` : ''}</Title>
        <Text c="dimmed" size="sm">
          Tu tablero de trabajo de hoy.
        </Text>
      </div>

      {/* Si algo no cargó, decirlo ANTES de los números: "Pacientes 0 /
          Sin alertas" con el servidor caído es un tablero que miente. */}
      {data.fallas.length > 0 && (
        <ErrorCarga
          que={`parte del tablero (${data.fallas.join(', ')}). Los ceros y vacíos de esas tarjetas no son datos`}
        />
      )}

      {/* KPIs */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <StatTile label="Pacientes" value={data.kpis.total} color="copper" />
        <StatTile label="Alto riesgo CV" value={data.kpis.highRisk} color="red" />
        <StatTile label="Con alertas" value={data.kpis.withAlerts} color="orange" />
        <StatTile
          label="Estadío CKM 3–4"
          value={(data.kpis.byStage[3] ?? 0) + (data.kpis.byStage[4] ?? 0)}
          color="violet"
        />
      </SimpleGrid>

      {/* Accesos rápidos */}
      <Group gap="sm">
        <Button component={Link} to="/Patient" variant="light" leftSection={<IconSearch size={16} />}>
          Buscar pacientes
        </Button>
        <Button
          component={Link}
          to={profile?.id ? `/Encounter?participant=Practitioner/${profile.id}` : '/Encounter'}
          variant="light"
          leftSection={<IconClipboardList size={16} />}
        >
          Mis evoluciones
        </Button>
        <Button component={Link} to="/ckm" variant="light" leftSection={<IconHeartRateMonitor size={16} />}>
          Panel CKM
        </Button>
      </Group>

      {/* Worklists */}
      <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="md">
        <WorklistCard
          title="Solicitudes de laboratorio"
          icon={<IconFlask size={18} />}
          color="orange"
          items={data.labProposals}
          loading={data.loading}
          emptyText="Sin solicitudes de pacientes pendientes de aprobar."
        />
        <WorklistCard
          title="Alertas CKM"
          icon={<IconAlertCircle size={18} />}
          color="red"
          items={data.alerts}
          loading={data.loading}
          emptyText="Sin alertas abiertas."
        />
        <WorklistCard
          title="Planes de cuidado en borrador"
          icon={<IconClipboardHeart size={18} />}
          color="violet"
          items={data.carePlans}
          loading={data.loading}
          emptyText="Sin planes esperando aprobación."
        />
        <WorklistCard
          title="Pacientes de alto riesgo"
          icon={<IconHeartRateMonitor size={18} />}
          color="red"
          items={data.highRisk}
          loading={data.loading}
          emptyText="Sin pacientes de alto riesgo cargados."
        />
        <WorklistCard
          title="Cuestionarios para interpretar"
          icon={<IconClipboardText size={18} />}
          color="teal"
          items={data.questionnaires}
          loading={data.loading}
          emptyText="Sin cuestionarios nuevos del paciente."
        />
        <WorklistCard
          title="Mis tareas"
          icon={<IconListCheck size={18} />}
          color="yellow"
          items={data.tasks}
          loading={data.loading}
          emptyText="Sin tareas pendientes."
        />
        <WorklistCard
          title="Próximos turnos"
          icon={<IconCalendarEvent size={18} />}
          color="blue"
          items={data.appointments}
          loading={data.loading}
          emptyText="Sin turnos próximos agendados."
        />
        <WorklistCard
          title="Mis evoluciones sin cerrar"
          icon={<IconClipboardList size={18} />}
          color="yellow"
          items={data.unfinishedEncounters}
          loading={data.loading}
          emptyText="Sin evoluciones abiertas."
        />
        <WorklistCard
          title="Resultados nuevos"
          icon={<IconReportMedical size={18} />}
          color="blue"
          items={data.results}
          loading={data.loading}
          emptyText="Sin resultados recientes."
        />
        <WorklistCard
          title="Cuestionarios sin responder"
          icon={<IconClipboardX size={18} />}
          color="gray"
          items={data.pendingQuestionnaires}
          loading={data.loading}
          emptyText="Sin cuestionarios a medio completar."
        />
        <WorklistCard
          title="Cumpleaños del mes"
          icon={<IconCake size={18} />}
          color="pink"
          items={data.birthdays}
          loading={data.loading}
          emptyText="Sin cumpleaños este mes."
        />
        <WorklistCard
          title="Últimos pacientes"
          icon={<IconUsers size={18} />}
          color="copper"
          items={data.recentPatients}
          loading={data.loading}
          emptyText="Todavía no hay pacientes."
        />
      </SimpleGrid>

      <Text size="xs" c="dimmed">
        Solicitudes de lab, alertas, planes, alto riesgo, cuestionarios y resultados son a nivel del centro; tus tareas,
        turnos y evoluciones son las tuyas.{' '}
        <Anchor component={Link} to="/ckm" size="xs">
          Ver panel CKM completo
        </Anchor>
      </Text>
    </Stack>
  );
}

function StatTile(props: { label: string; value: number; color: string }): JSX.Element {
  return (
    <Paper withBorder radius="md" p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {props.label}
      </Text>
      <Text fw={700} fz={28} c={`${props.color}.7`} lh={1.1} mt={4}>
        {props.value}
      </Text>
    </Paper>
  );
}

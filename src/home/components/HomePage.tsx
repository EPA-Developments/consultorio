// Home del médico: encabezado con saludo + KPIs + accesos rápidos, y una grilla
// de worklists accionables (bandeja / mi trabajo / seguimiento). Solo lectura;
// toda la lógica de datos vive en useHomeData + el módulo puro home-data.
import { Anchor, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useMedplumProfile } from '@medplum/react';
import {
  IconAlertCircle,
  IconClipboardHeart,
  IconClipboardList,
  IconClipboardText,
  IconFlask,
  IconHeartRateMonitor,
  IconListCheck,
  IconSearch,
  IconUsers,
} from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';
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
          title="Últimos pacientes"
          icon={<IconUsers size={18} />}
          color="copper"
          items={data.recentPatients}
          loading={data.loading}
          emptyText="Todavía no hay pacientes."
        />
      </SimpleGrid>

      <Text size="xs" c="dimmed">
        Las solicitudes de laboratorio, alertas, planes, alto riesgo y cuestionarios son a nivel del centro; las tareas
        son las asignadas a vos.{' '}
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

// Tarjeta genérica de "worklist" del home: encabezado con ícono, título y
// contador, y una lista de filas clickeables (paciente + contexto + badge).
// Reutilizable por todos los widgets del home.
import { Badge, Group, Loader, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router';
import type { WorklistItem } from '../home-data';

export function WorklistCard(props: {
  title: string;
  icon: ReactNode;
  color: string;
  items: WorklistItem[];
  emptyText: string;
  loading?: boolean;
  maxItems?: number;
}): JSX.Element {
  const max = props.maxItems ?? 6;
  const visible = props.items.slice(0, max);
  const overflow = props.items.length - visible.length;

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon variant="light" color={props.color} radius="md">
            {props.icon}
          </ThemeIcon>
          <Text fw={600}>{props.title}</Text>
        </Group>
        {!props.loading && props.items.length > 0 && (
          <Badge variant="light" color={props.color}>
            {props.items.length}
          </Badge>
        )}
      </Group>

      {props.loading ? (
        <Group justify="center" p="md">
          <Loader size="sm" />
        </Group>
      ) : props.items.length === 0 ? (
        <Text size="sm" c="dimmed" py="xs">
          {props.emptyText}
        </Text>
      ) : (
        <Stack gap={2}>
          {visible.map((item) => (
            <Row key={item.id} item={item} />
          ))}
          {overflow > 0 && (
            <Text size="xs" c="dimmed" mt={4}>
              + {overflow} más
            </Text>
          )}
        </Stack>
      )}
    </Paper>
  );
}

function Row(props: { item: WorklistItem }): JSX.Element {
  const { item } = props;
  const content = (
    <Group justify="space-between" wrap="nowrap" gap="xs" py={6} px="xs" style={{ borderRadius: 6 }}>
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="sm" fw={500} truncate>
          {item.primary}
        </Text>
        {item.secondary && (
          <Text size="xs" c="dimmed" truncate>
            {item.secondary}
          </Text>
        )}
      </Stack>
      {item.badge && (
        <Badge size="sm" variant="light" color={item.badgeColor ?? 'gray'} style={{ flexShrink: 0 }}>
          {item.badge}
        </Badge>
      )}
    </Group>
  );
  return item.href ? (
    <Text
      component={Link}
      to={item.href}
      td="none"
      c="inherit"
      className="worklist-row"
      display="block"
      style={{ borderRadius: 6 }}
    >
      {content}
    </Text>
  ) : (
    content
  );
}

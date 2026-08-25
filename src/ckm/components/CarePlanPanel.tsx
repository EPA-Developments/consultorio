// Panel "Plan Bienestar 100 días" del chart: genera el plan con IA (bot
// favaloro-ckm-careplan-generate vía executeBot), lista los CarePlan del
// paciente y permite al médico APROBAR (draft -> active) o DESCARTAR
// (draft -> revoked) los borradores generados por IA.
import { Accordion, Alert, Badge, Button, Group, List, Paper, Stack, Text, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { CarePlan, Goal, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCheck, IconRobot, IconSparkles, IconTrash } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { buscarBotPropio } from '../../bot-lookup';
import { BOT_CKM_CAREPLAN_GENERATE } from '../../bot-names';
import { AI_GENERATED_TAG } from '../careplan';

export interface CarePlanPanelProps {
  patient: Patient;
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'yellow',
  active: 'teal',
  revoked: 'gray',
  completed: 'blue',
};

function isAiGenerated(plan: CarePlan): boolean {
  return Boolean(plan.meta?.tag?.some((t) => t.system === AI_GENERATED_TAG.system && t.code === AI_GENERATED_TAG.code));
}

export function CarePlanPanel(props: CarePlanPanelProps): JSX.Element {
  const medplum = useMedplum();
  const { patient } = props;
  const [plans, setPlans] = useState<CarePlan[]>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    medplum
      .searchResources('CarePlan', { subject: `Patient/${patient.id}`, _sort: '-_lastUpdated', _count: '20' })
      .then(setPlans)
      .catch((err) => showNotification({ color: 'red', message: normalizeErrorString(err) }));
  }, [medplum, patient.id]);

  useEffect(load, [load]);

  async function generate(): Promise<void> {
    setBusy(true);
    try {
      // buscarBotPropio y no searchOne: el nombre de un bot de un proyecto
      // linkeado también matchea, y generar el plan con el bot de otro
      // consultorio le mandaría el paciente a ese proyecto.
      const bot = await buscarBotPropio(medplum, BOT_CKM_CAREPLAN_GENERATE);
      if (!bot?.id) {
        showNotification({
          color: 'red',
          message: `El bot ${BOT_CKM_CAREPLAN_GENERATE} no está desplegado en el proyecto.`,
        });
        return;
      }
      await medplum.executeBot(bot.id, patient, 'application/fhir+json');
      showNotification({ color: 'green', message: 'Plan Bienestar generado (borrador). Revisalo y aprobalo.' });
      load();
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err) });
    } finally {
      setBusy(false);
    }
  }

  async function approve(plan: CarePlan): Promise<void> {
    try {
      await medplum.updateResource({ ...plan, status: 'active' });
      // Activar los objetivos referenciados.
      for (const ref of plan.goal ?? []) {
        const id = ref.reference?.split('/')[1];
        if (id) {
          const goal = await medplum.readResource('Goal', id);
          await medplum.updateResource<Goal>({ ...goal, lifecycleStatus: 'accepted' });
        }
      }
      showNotification({ color: 'green', message: 'Plan aprobado y activado.' });
      load();
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err) });
    }
  }

  async function discard(plan: CarePlan): Promise<void> {
    try {
      await medplum.updateResource({ ...plan, status: 'revoked' });
      showNotification({ color: 'gray', message: 'Borrador descartado.' });
      load();
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err) });
    }
  }

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Title order={4}>Plan Bienestar 100 días</Title>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconSparkles size={16} />}
            loading={busy}
            onClick={() => void generate()}
          >
            Generar con IA
          </Button>
        </Group>

        {plans === undefined && (
          <Text size="sm" c="dimmed">
            Cargando…
          </Text>
        )}
        {plans?.length === 0 && (
          <Text size="sm" c="dimmed">
            Sin planes. Generá un borrador con IA a partir del estadío y el riesgo CKM del paciente.
          </Text>
        )}

        {plans && plans.length > 0 && (
          <Accordion variant="contained" chevronPosition="left">
            {plans.map((plan) => (
              <Accordion.Item key={plan.id} value={plan.id as string}>
                <Accordion.Control icon={isAiGenerated(plan) ? <IconRobot size={16} /> : undefined}>
                  <Group justify="space-between" wrap="nowrap" pr="sm">
                    <Text size="sm" lineClamp={1}>
                      {plan.title ?? 'Plan de cuidados'}
                    </Text>
                    <Badge size="sm" color={STATUS_COLOR[plan.status ?? ''] ?? 'gray'}>
                      {plan.status}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    {plan.status === 'draft' && isAiGenerated(plan) && (
                      <Alert color="yellow" p="xs">
                        Borrador generado por IA. Revisalo y, si estás de acuerdo, aprobalo para activarlo.
                      </Alert>
                    )}
                    {plan.description && <Text size="sm">{plan.description}</Text>}
                    {plan.activity && plan.activity.length > 0 && (
                      <List size="sm" spacing={4}>
                        {plan.activity.map((a, i) => (
                          <List.Item key={i}>
                            <Text component="span" fw={500}>
                              {a.detail?.code?.text}
                            </Text>
                            {a.detail?.description ? `: ${a.detail.description}` : ''}
                          </List.Item>
                        ))}
                      </List>
                    )}
                    {plan.status === 'draft' && (
                      <Group justify="flex-end" gap="xs">
                        <Button
                          size="xs"
                          variant="subtle"
                          color="gray"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => void discard(plan)}
                        >
                          Descartar
                        </Button>
                        <Button
                          size="xs"
                          color="teal"
                          leftSection={<IconCheck size={14} />}
                          onClick={() => void approve(plan)}
                        >
                          Aprobar y activar
                        </Button>
                      </Group>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Stack>
    </Paper>
  );
}

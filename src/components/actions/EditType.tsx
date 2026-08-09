// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Modal } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import { getQuestionnaireAnswers, normalizeErrorString } from '@medplum/core';
import type { PatchOperation } from '@medplum/core';
import type { CodeableConcept, Coding, Encounter, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { TIPOS_ENCUENTRO } from './encounter-coding';

interface EditTypeProps {
  encounter: Encounter;
  onChange: (encounter: Encounter) => void;
}

export function EditType(props: EditTypeProps): JSX.Element {
  const medplum = useMedplum();
  const [opened, handlers] = useDisclosure(false);

  function handleQuestionnaireSubmit(formData: QuestionnaireResponse): void {
    const type = getQuestionnaireAnswers(formData)['type'].valueCoding;
    updateEncounterType(type);

    handlers.close();
  }

  function updateEncounterType(type?: Coding): void {
    if (!type) {
      throw new Error('Tipo de atención inválido');
    }
    const encounterId = props.encounter.id as string;
    const typeConcept: CodeableConcept = {
      coding: [type],
    };

    const op = props.encounter.type ? 'replace' : 'add';
    const ops: PatchOperation[] = [
      { op: 'test', path: '/meta/versionId', value: props.encounter.meta?.versionId },
      { op, path: '/type', value: [typeConcept] },
    ];

    medplum
      .patchResource('Encounter', encounterId, ops)
      .then((encounter) => {
        props.onChange(encounter);
        showNotification({
          icon: <IconCircleCheck />,
          title: 'Listo',
          message: 'Tipo de atención actualizado',
        });
      })
      .catch((err) => {
        showNotification({
          color: 'red',
          icon: <IconCircleOff />,
          title: 'No se pudo actualizar el tipo',
          message: normalizeErrorString(err),
        });
      });
  }

  return (
    <div>
      <Button fullWidth onClick={handlers.open}>
        Cambiar el tipo de atención
      </Button>
      <Modal opened={opened} onClose={handlers.close}>
        <QuestionnaireForm questionnaire={editTypeQuestionnaire} onSubmit={handleQuestionnaireSubmit} />
      </Modal>
    </div>
  );
}

const editTypeQuestionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'active',
  id: 'edit-type',
  title: 'Cambiar el tipo de atención',
  item: [
    {
      linkId: 'type',
      type: 'choice',
      text: 'Nuevo tipo:',
      answerOption: TIPOS_ENCUENTRO,
    },
  ],
};

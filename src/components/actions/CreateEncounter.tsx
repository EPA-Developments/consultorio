// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Modal } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { getDisplayString, getQuestionnaireAnswers, getReferenceString, normalizeErrorString } from '@medplum/core';
import type {
  Coding,
  Encounter,
  Patient,
  Practitioner,
  Questionnaire,
  QuestionnaireResponse,
  Reference,
} from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum, useMedplumProfile } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { CLASES_ENCUENTRO, TIPOS_ENCUENTRO } from './encounter-coding';

interface CreateEncounterProps {
  readonly opened: boolean;
  readonly handlers: {
    readonly open: () => void;
    readonly close: () => void;
    readonly toggle: () => void;
  };
}

export function CreateEncounter({ opened, handlers }: CreateEncounterProps): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile() as Practitioner;
  const navigate = useNavigate();

  function handleQuestionnaireSubmit(formData: QuestionnaireResponse): void {
    const answers = getQuestionnaireAnswers(formData);
    const patientReference = answers['patient'].valueReference as Reference<Patient>;
    const encounterClass = answers['class'].valueCoding as Coding;
    const encounterType = answers['type']?.valueCoding ?? undefined;
    const encounterDate = answers['date'].valueDate as string;
    createEncounter(patientReference, encounterClass, encounterDate, encounterType);
    handlers.close();
  }

  function createEncounter(patient: Reference<Patient>, encounterClass: Coding, date: string, type?: Coding): void {
    const encounterData: Encounter = {
      resourceType: 'Encounter',
      subject: patient,
      class: encounterClass,
      status: 'in-progress',
      period: {
        start: date,
      },
      type: type
        ? [
            {
              coding: [type],
            },
          ]
        : undefined,
      participant: [
        {
          type: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                  code: 'ATND',
                  display: 'attender',
                },
              ],
            },
          ],
          individual: { reference: getReferenceString(profile), display: getDisplayString(profile) },
        },
      ],
    };

    medplum
      .createResource(encounterData)
      .then((encounter) => {
        showNotification({
          icon: <IconCircleCheck />,
          title: 'Listo',
          message: 'Evolución creada',
        });
        navigate(`/Encounter/${encounter.id}`)?.catch(console.error);
      })
      .catch((err) => {
        showNotification({
          color: 'red',
          icon: <IconCircleOff />,
          title: 'No se pudo crear la evolución',
          message: normalizeErrorString(err),
        });
      });
  }

  return (
    <Modal opened={opened} onClose={handlers.close}>
      <p>Nueva evolución</p>
      <QuestionnaireForm questionnaire={createEncounterQuestionnaire} onSubmit={handleQuestionnaireSubmit} />
    </Modal>
  );
}

const createEncounterQuestionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'active',
  title: 'Nueva evolución',
  id: 'new-encounter',
  item: [
    {
      linkId: 'patient',
      type: 'reference',
      text: '¿De qué paciente es esta evolución?',
      required: true,
      extension: [
        {
          url: 'http://hl7.org/fhir/StructureDefinition/questionnaire-referenceResource',
          valueCodeableConcept: {
            coding: [
              {
                code: 'Patient',
              },
            ],
          },
        },
      ],
    },
    {
      linkId: 'date',
      type: 'date',
      text: '¿Qué fecha tiene?',
      required: true,
      initial: [
        {
          valueDate: new Date().toISOString().slice(0, 10),
        },
      ],
    },
    {
      linkId: 'class',
      type: 'choice',
      text: '¿Dónde se atendió?',
      required: true,
      answerOption: CLASES_ENCUENTRO,
    },
    {
      linkId: 'type',
      type: 'choice',
      text: '¿Qué tipo de atención fue?',
      answerOption: TIPOS_ENCUENTRO,
    },
  ],
};

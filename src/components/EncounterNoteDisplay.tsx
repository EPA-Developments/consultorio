// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Paper, Stack, Title } from '@mantine/core';
import type { TitleOrder } from '@mantine/core';
import { formatDate } from '@medplum/core';
import type {
  Encounter,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
} from '@medplum/fhirtypes';
import { CodeableConceptDisplay, QuantityDisplay, RangeDisplay } from '@medplum/react';
import type { JSX } from 'react';

interface EncounterNoteDisplayProps {
  response: QuestionnaireResponse;
  encounter: Encounter;
}

export function EncounterNoteDisplay(props: EncounterNoteDisplayProps): JSX.Element {
  // Antes estos dos casos eran `throw` dentro del render: tiraban abajo la
  // pantalla entera de la evolución. Un dato inconsistente se informa, no
  // rompe la página.
  if (props.response.encounter?.reference !== `Encounter/${props.encounter.id}`) {
    return <Paper>La nota encontrada pertenece a otra evolución; no se muestra para no mezclar historias.</Paper>;
  }
  if (!props.response.item) {
    return <Paper>La nota existe pero está vacía.</Paper>;
  }
  const items = props.response.item;

  return (
    <Paper>
      <Stack>{items.map((item) => getItemDisplay(item, 4))}</Stack>
    </Paper>
  );
}

function getItemDisplay(item: QuestionnaireResponseItem, order: TitleOrder): JSX.Element {
  const title = item.text;
  const answer = item.answer;
  const nestedAnswers = item.item;

  return (
    <Stack>
      <Title order={order}>{title}</Title>
      <Stack key={item.linkId}>
        {answer && answer.length > 0
          ? getAnswerDisplay(answer[0])
          : nestedAnswers?.map((nestedAnswer) => getItemDisplay(nestedAnswer, Math.min(order + 1, 6) as TitleOrder))}
      </Stack>
    </Stack>
  );
}

function getAnswerDisplay(answer?: QuestionnaireResponseItemAnswer): JSX.Element {
  if (!answer) {
    return <p>—</p>;
  }
  const [[key, value]] = Object.entries(answer);

  switch (key) {
    case 'valueInteger':
      return <p>{value}</p>;
    case 'valueQuantity':
      return <QuantityDisplay value={value} />;
    case 'valueString':
      return <p>{value}</p>;
    case 'valueCoding':
      return <CodeableConceptDisplay value={{ coding: [value] }} />;
    case 'valueRange':
      return <RangeDisplay value={value} />;
    case 'valueDateTime':
      return <p>{formatDate(value)}</p>;
    default:
      return <p>{value}</p>;
  }
}

// Pantalla de la evolución: la nota, los detalles y el historial.
//
// La nota usa el cuestionario embebido en el código (ver nota-evolucion.ts).
// El diseño anterior lo buscaba en el servidor por código de tipo y, como el
// seed nunca se corrió y los códigos no coincidían, TODA la pantalla quedaba en
// un spinner infinito. La regla que quedó de eso: acá ningún estado de carga
// puede ser eterno y ningún error puede ser invisible.
import { Alert, Tabs } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Encounter, Practitioner, QuestionnaireResponse } from '@medplum/fhirtypes';
import {
  Document,
  Loading,
  QuestionnaireForm,
  ResourceHistoryTable,
  ResourceTable,
  useMedplum,
  useMedplumProfile,
} from '@medplum/react';
import { IconAlertTriangle, IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { NOTA_EVOLUCION, recursosDeLaNota } from '../encounters/nota-evolucion';
import { EncounterNoteDisplay } from './EncounterNoteDisplay';

interface EncounterDetailsProps {
  encounter: Encounter;
}

/** Estado de la búsqueda de la nota: cargando, resuelta (con o sin nota), o error. */
type EstadoNota = { estado: 'cargando' } | { estado: 'listo'; nota?: QuestionnaireResponse } | { estado: 'error' };

export function EncounterDetails(props: EncounterDetailsProps): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const navigate = useNavigate();
  const [nota, setNota] = useState<EstadoNota>({ estado: 'cargando' });

  const id = props.encounter.id;

  // [valor, etiqueta]: el valor es el segmento de la URL y NO se traduce; lo
  // que se traduce es lo que se lee. Mezclarlos rompería los enlaces guardados.
  const tabs: [string, string][] = [
    ['note', 'Nota'],
    ['details', 'Detalles'],
    ['history', 'Historial'],
  ];
  const tab = window.location.pathname.split('/').pop();
  const currentTab = tab && tabs.some(([valor]) => valor === tab) ? tab : tabs[0][0];

  useEffect(() => {
    let cancelled = false;
    medplum
      .searchOne('QuestionnaireResponse', { encounter: getReferenceString(props.encounter) })
      .then((r) => {
        if (!cancelled) {
          setNota({ estado: 'listo', nota: r });
        }
      })
      .catch((err) => {
        console.error('Evolución: error buscando la nota', err);
        if (!cancelled) {
          setNota({ estado: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [medplum, props.encounter]);

  function handleTabChange(newTab: string | null): void {
    navigate(`/Encounter/${id}/${newTab ?? ''}`)?.catch(console.error);
  }

  async function handleQuestionnaireSubmit(formData: QuestionnaireResponse): Promise<void> {
    const practitioner = profile?.resourceType === 'Practitioner' ? (profile as Practitioner) : undefined;
    // Una sola transacción: la respuesta, los signos vitales con sus códigos
    // canónicos y la impresión clínica entran juntos o no entra nada.
    const bundle = recursosDeLaNota(formData, props.encounter, practitioner);
    try {
      const resultado = await medplum.executeBatch(bundle);
      const creada = resultado.entry
        ?.map((e) => e.resource)
        .find((r) => r?.resourceType === 'QuestionnaireResponse') as QuestionnaireResponse | undefined;
      setNota({ estado: 'listo', nota: creada ?? formData });
      showNotification({
        icon: <IconCircleCheck />,
        title: 'Listo',
        message: 'Nota guardada. Los signos vitales entraron a la historia del paciente.',
      });
    } catch (err) {
      // La nota NO se guardó (la transacción es atómica): hay que decirlo,
      // porque el médico acaba de escribirla y la va a perder si navega.
      showNotification({
        color: 'red',
        icon: <IconCircleOff />,
        title: 'No se pudo guardar la nota',
        message: normalizeErrorString(err),
        autoClose: false,
      });
    }
  }

  return (
    <Document>
      <Tabs value={currentTab} onChange={handleTabChange}>
        <Tabs.List mb="sm">
          {tabs.map(([valor, etiqueta]) => (
            <Tabs.Tab key={valor} value={valor}>
              {etiqueta}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="note">
          {nota.estado === 'cargando' && <Loading />}
          {nota.estado === 'error' && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              No se pudo cargar la nota de esta evolución. No significa que no exista: falló la lectura. Recargá la
              página; si persiste, avisá al equipo técnico.
            </Alert>
          )}
          {nota.estado === 'listo' &&
            (nota.nota ? (
              <EncounterNoteDisplay response={nota.nota} encounter={props.encounter} />
            ) : (
              <QuestionnaireForm questionnaire={NOTA_EVOLUCION} onSubmit={handleQuestionnaireSubmit} />
            ))}
        </Tabs.Panel>
        <Tabs.Panel value="details">
          <ResourceTable value={props.encounter} ignoreMissingValues={true} />
        </Tabs.Panel>
        <Tabs.Panel value="history">
          <ResourceHistoryTable resourceType="Encounter" id={props.encounter.id} />
        </Tabs.Panel>
      </Tabs>
    </Document>
  );
}

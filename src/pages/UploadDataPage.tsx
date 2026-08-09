// Carga de catálogos al servidor, para el administrador.
//
// Quedan solo las cargas que el producto usa: las ObservationDefinition de
// biomarcadores y los cuestionarios de Life's Essential 8. Las demás
// ('core', 'example', 'questionnaire', 'bots') eran del template: subían el
// paciente de ejemplo Homer Simpson, cuestionarios de obstetricia en inglés y
// un despliegue de bots paralelo al documentado (deploy-bots-server). Un botón
// que puede sembrar datos de demo en el proyecto real no es una herramienta:
// es un incidente esperando el click.
import { Button, LoadingOverlay } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { isOk, normalizeErrorString } from '@medplum/core';
import type { MedplumClient } from '@medplum/core';
import type { Bundle } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import biomarkerDefinitions from '../../data/ckm/biomarker-definitions.json';
import le8Questionnaires from '../../data/ckm/le8-questionnaires.json';

const CARGAS: Record<string, { etiqueta: string; bundle: Bundle; mensaje: (n: number) => string }> = {
  biomarkers: {
    etiqueta: 'las definiciones de biomarcadores',
    bundle: biomarkerDefinitions as unknown as Bundle,
    mensaje: (n) => `Subidas ${n} definiciones de biomarcadores`,
  },
  le8: {
    etiqueta: 'los cuestionarios de Life’s Essential 8',
    bundle: le8Questionnaires as unknown as Bundle,
    mensaje: (n) => `Subidos ${n} cuestionarios de Life’s Essential 8`,
  },
};

export function UploadDataPage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [pageDisabled, setPageDisabled] = useState<boolean>(false);

  const { dataType } = useParams();
  const carga = dataType ? CARGAS[dataType] : undefined;

  const handleUpload = useCallback(() => {
    if (!carga) {
      return;
    }
    setPageDisabled(true);
    subirBundle(medplum, carga.bundle, carga.mensaje)
      .then(() => navigate(-1))
      .catch((error) => {
        showNotification({
          color: 'red',
          icon: <IconCircleOff />,
          title: 'No se pudo completar la carga',
          message: normalizeErrorString(error),
        });
      })
      .finally(() => setPageDisabled(false));
  }, [medplum, carga, navigate]);

  if (!carga) {
    return (
      <Document>
        <p>No hay nada para cargar en esta dirección. Las cargas disponibles son /upload/biomarkers y /upload/le8.</p>
      </Document>
    );
  }

  return (
    <Document>
      <LoadingOverlay visible={pageDisabled} />
      <Button disabled={pageDisabled} onClick={handleUpload}>
        Cargar {carga.etiqueta}
      </Button>
    </Document>
  );
}

async function subirBundle(medplum: MedplumClient, bundle: Bundle, mensaje: (n: number) => string): Promise<void> {
  const result = await medplum.executeBatch(bundle);
  const ok = result.entry?.every((entry) => entry.response?.outcome && isOk(entry.response.outcome));
  if (!ok) {
    throw new Error('El servidor rechazó parte del lote; no se subió completo');
  }
  showNotification({
    icon: <IconCircleCheck />,
    title: 'Listo',
    message: mensaje(result.entry?.length ?? 0),
  });
}

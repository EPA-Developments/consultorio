// Sección "Laboratorio": el espacio propio de las órdenes de análisis.
//
// Mismo andamiaje que Prescripciones (elegir paciente → contexto → trabajar);
// el contenido es el LabOrderPanel del chart — presets, cobertura, emisión
// por el gate compartido. Un solo camino de escritura con dos puertas.
//
// ?preset= en la URL preselecciona un panel (por panelCode o nombre) o el
// perfil completo ('completo'), y sobrevive al paso de elegir paciente: eso
// habilita deep-links desde el Portal (la solicitud del paciente llega con el
// preset puesto y el médico solo confirma).
import type { JSX } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { EspacioPacientePage } from '../components/EspacioPaciente';
import { LabOrderPanel } from '../laborders/components/LabOrderPanel';

export function LaboratorioPage(): JSX.Element {
  const { patientId } = useParams();
  const [searchParams] = useSearchParams();
  const preset = searchParams.get('preset') ?? undefined;
  return (
    <EspacioPacientePage
      titulo="Laboratorio"
      descripcion="Órdenes de análisis por preset o marcador por marcador, emitidas con la misma validación de matrícula y REFEPS que las recetas."
      base="/laboratorio"
      patientId={patientId}
    >
      {(patient) => <LabOrderPanel patient={patient} presetInicial={preset} />}
    </EspacioPacientePage>
  );
}

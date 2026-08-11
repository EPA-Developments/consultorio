// Sección "Prescripciones": el espacio propio del acto de prescribir.
//
// El andamiaje (elegir paciente → contexto → trabajar) es el compartido de
// EspacioPaciente; esta página solo aporta la emisión de recetas. La emisión
// es EXACTAMENTE la misma que en la pestaña Recetas del chart: RecetasPanel,
// con el gate local + REFEPS compartido — un solo camino de escritura con dos
// puertas.
import type { JSX } from 'react';
import { useParams } from 'react-router';
import { EspacioPacientePage } from '../components/EspacioPaciente';
import { RecetasPanel } from '../recetas/components/RecetasPanel';

export function PrescripcionesPage(): JSX.Element {
  const { patientId } = useParams();
  return (
    <EspacioPacientePage
      titulo="Prescripciones"
      descripcion="Emisión de recetas por nombre genérico (DCI, Ley 25.649), validada contra REFEPS y codificada con SNOMED CT Edición Argentina."
      base="/prescripciones"
      patientId={patientId}
    >
      {(patient, cobertura) => <RecetasPanel patient={patient} cobertura={cobertura} />}
    </EspacioPacientePage>
  );
}

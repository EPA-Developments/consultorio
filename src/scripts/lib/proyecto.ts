// El proyecto contra el que este repo tiene derecho a escribir.
//
// El servidor api.medplum.com.ar hospeda varios consultorios, y los proyectos
// se ven entre sí por Project.link (Favaloro → Super Admin → Biowellness). Un
// ClientApplication equivocado en la línea de comandos no da error: escribe,
// pero en el proyecto de otro. Ya pasó con los bots (commit e900d18).
//
// Por eso el chequeo es POR DEFECTO y no opt-in: un script de este repo que
// se conecta a un proyecto que no es Favaloro aborta antes de tocar nada.
import type { MedplumClient } from '@medplum/core';

/** Favaloro | Medplum Argentina, en api.medplum.com.ar. */
export const PROYECTO_FAVALORO = '78ead38c-0f59-4576-b196-71685537588c';

/**
 * Aborta si el client no pertenece al proyecto esperado.
 *
 * `MEDPLUM_EXPECTED_PROJECT` lo sobreescribe, para un segundo deploy del mismo
 * repo en otro proyecto; con el valor `*` se desactiva el chequeo (a mano y a
 * conciencia, nunca en un script automatizado).
 */
export function verificarProyecto(medplum: MedplumClient): string {
  const projectId = medplum.getProject()?.id;
  if (!projectId) {
    throw new Error('No se pudo determinar el proyecto del ClientApplication.');
  }
  const esperado = process.env.MEDPLUM_EXPECTED_PROJECT ?? PROYECTO_FAVALORO;
  if (esperado !== '*' && esperado !== projectId) {
    throw new Error(
      `El ClientApplication pertenece al proyecto ${projectId}, y este repo escribe en ${esperado}.\n` +
        '  En este servidor conviven varios consultorios y los proyectos se ven entre sí:\n' +
        '  seguir sería escribir en el proyecto de otro. Operación abortada.\n' +
        '  Si el proyecto correcto es realmente ese, corré con MEDPLUM_EXPECTED_PROJECT=' +
        projectId
    );
  }
  return projectId;
}

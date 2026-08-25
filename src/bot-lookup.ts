// Resolver un Bot por nombre SIN traerse el de otro proyecto.
//
// Este proyecto linkea a otros (Favaloro → Super Admin → Biowellness) y en
// Medplum los links encadenan: una búsqueda por nombre devuelve también los
// bots de los proyectos linkeados, sin ninguna señal de error. Los nombres
// prefijados (`src/bot-names.ts`) ya hacen que una colisión sea improbable;
// esto es el segundo cinturón, y el único que sirve si alguien vuelve a
// desplegar un bot con el nombre viejo en otro lado.
//
// Hay dos modos porque los dos caminos no toleran lo mismo:
//
// - 'estricto' (deploy): ante la duda, aborta. Escribir sobre el bot de otro
//   proyecto es peor que no desplegar.
// - 'tolerante' (lectura desde el FrontEnd y diagnósticos): el navegador NO
//   recibe `meta.project` salvo en extended mode, así que exigirlo dejaría al
//   panel sin encontrar nunca su propio bot. Un candidato sin proyecto conocido
//   se acepta; uno que consta de otro proyecto, no.
import type { MedplumClient } from '@medplum/core';
import type { Bot } from '@medplum/fhirtypes';

export type ModoBusqueda = 'estricto' | 'tolerante';

/** El proyecto al que pertenece un recurso (meta.project, en extended mode). */
export function proyectoDe(recurso: { meta?: unknown }): string | undefined {
  return (recurso.meta as { project?: string } | undefined)?.project;
}

/**
 * Elige, entre los candidatos de una búsqueda por nombre, el bot de ESTE
 * proyecto. Función pura: toda la decisión está acá y se testea sin servidor.
 *
 * Devuelve `undefined` cuando el bot no existe en este proyecto — que es
 * distinto de "no existe": puede existir con ese nombre en un proyecto
 * linkeado, y ese no es nuestro bot.
 */
export function elegirBotPropio(
  candidatos: Bot[],
  nombre: string,
  projectId: string | undefined,
  modo: ModoBusqueda
): Bot | undefined {
  // El servidor puede devolver coincidencias parciales por nombre.
  const exactos = candidatos.filter((b) => b.name === nombre);
  if (exactos.length === 0) {
    return undefined;
  }

  const propios = exactos.filter((b) => proyectoDe(b) === projectId);
  if (projectId && propios.length > 0) {
    return propios[0];
  }

  const opacos = exactos.filter((b) => !proyectoDe(b));
  if (opacos.length > 0) {
    if (modo === 'tolerante') {
      return opacos[0];
    }
    throw new Error(
      `No puedo determinar a qué proyecto pertenece el Bot «${nombre}» (${opacos
        .map((b) => b.id)
        .join(', ')}): la búsqueda no devuelve meta.project.\n` +
        '  Sin ese dato, desplegar puede pisar el bot de otro proyecto linkeado.\n' +
        '  Usá un ClientApplication admin del proyecto, o verificá el bot a mano antes de seguir.'
    );
  }

  // Todos los candidatos constan de otros proyectos: acá no está.
  return undefined;
}

/**
 * Busca el bot `nombre` en el proyecto de la sesión actual.
 *
 * Reemplaza a `medplum.searchOne('Bot', 'name=...')`, que no distingue entre
 * el bot propio y el de un proyecto linkeado.
 */
export async function buscarBotPropio(
  medplum: MedplumClient,
  nombre: string,
  modo: ModoBusqueda = 'tolerante'
): Promise<Bot | undefined> {
  const candidatos = (await medplum.searchResources('Bot', { name: nombre, _count: '50' })) as Bot[];
  return elegirBotPropio(candidatos, nombre, medplum.getProject()?.id, modo);
}

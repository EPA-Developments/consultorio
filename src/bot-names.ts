// Nombres de los Bots en el servidor — fuente única, para el FrontEnd y para
// los scripts de operación.
//
// POR QUÉ EXISTE ESTE ARCHIVO
//
// Los nombres de los bots eran los genéricos del template (`ckm-recalculate`,
// `careplan-generate`, ...) y este proyecto LINKEA a otros: Favaloro → Super
// Admin → Biowellness. En Medplum, un proyecto ve por búsqueda los recursos de
// los proyectos que linkea, así que `Bot?name=careplan-generate` lanzado desde
// Favaloro podía devolver —y devolvía— el bot de Biowellness. En el camino de
// escritura eso ya explotó una vez (commit e900d18: el deploy pisó el código
// ejecutable de bots ajenos); en el de lectura significa ejecutar el bot de
// OTRO consultorio con un paciente nuestro.
//
// El prefijo `favaloro-` hace que el nombre sea único de este proyecto, así la
// búsqueda por nombre deja de poder colisionar. `deploy-bots-server` además
// filtra por `meta.project`, pero eso solo protege el deploy: el navegador no
// recibe `meta.project` sin extended mode, y ahí el nombre único es la defensa.
//
// Cambiar un nombre acá NO renombra nada en el servidor: los Bots existentes
// hay que migrarlos con `npm run rename-bots` ANTES del siguiente deploy, o el
// deploy va a crear bots nuevos y van a quedar dos Subscriptions sobre el mismo
// criteria (cada laboratorio recalculando dos veces).

/** Prefijo de proyecto. Todo bot desplegado por este repo lo lleva. */
export const PREFIJO_BOTS = 'favaloro-';

/**
 * Nombre del bot a partir de su ruta: prefijo + módulo + archivo.
 *
 * `src/bots/ckm/sdoh-response.ts` -> `favaloro-ckm-sdoh-response`
 *
 * Cuando el archivo ya empieza con el módulo no se repite el segmento:
 * `src/bots/ckm/ckm-alerts.ts` -> `favaloro-ckm-alerts`, no `favaloro-ckm-ckm-alerts`.
 */
export function nombreDeBot(src: string): string {
  const partes = src.split('/');
  const archivo = (partes.pop() as string).replace(/\.ts$/, '');
  const modulo = partes.pop() as string;
  const cuerpo = archivo === modulo || archivo.startsWith(`${modulo}-`) ? archivo : `${modulo}-${archivo}`;
  return `${PREFIJO_BOTS}${cuerpo}`;
}

/** El nombre con el que el bot se desplegó ANTES del prefijo (para migrar). */
export function nombreLegadoDeBot(src: string): string {
  return (src.split('/').pop() as string).replace(/\.ts$/, '');
}

export interface IdentidadBot {
  /** Ruta del fuente en el repo. Es la clave: el resto se deriva de acá. */
  src: string;
  /** Nombre en el servidor (único dentro del proyecto). */
  nombre: string;
  /** Nombre viejo, sin prefijo. Solo lo usa la migración. */
  legado: string;
}

function identidad(src: string): IdentidadBot {
  return { src, nombre: nombreDeBot(src), legado: nombreLegadoDeBot(src) };
}

/** Los bots que este repo despliega. El orden no importa. */
export const BOTS: IdentidadBot[] = [
  identidad('src/bots/ckm/ckm-recalculate.ts'),
  identidad('src/bots/ckm/sdoh-response.ts'),
  identidad('src/bots/ckm/ckm-alerts.ts'),
  identidad('src/bots/ckm/careplan-generate.ts'),
  identidad('src/bots/refeps/refeps-verify.ts'),
];

export const BOT_CKM_RECALCULATE = nombreDeBot('src/bots/ckm/ckm-recalculate.ts');
export const BOT_CKM_SDOH_RESPONSE = nombreDeBot('src/bots/ckm/sdoh-response.ts');
export const BOT_CKM_ALERTS = nombreDeBot('src/bots/ckm/ckm-alerts.ts');
export const BOT_CKM_CAREPLAN_GENERATE = nombreDeBot('src/bots/ckm/careplan-generate.ts');
export const BOT_REFEPS_VERIFY = nombreDeBot('src/bots/refeps/refeps-verify.ts');

/** Los tres bots del circuito CKM automático (los que tienen Subscription). */
export const BOTS_CKM = [BOT_CKM_RECALCULATE, BOT_CKM_SDOH_RESPONSE, BOT_CKM_ALERTS];

/** La identidad del bot cuyo fuente es `src`. Lanza si no está en la tabla. */
export function identidadDeBot(src: string): IdentidadBot {
  const encontrada = BOTS.find((b) => b.src === src);
  if (!encontrada) {
    throw new Error(`El bot ${src} no está en la tabla de src/bot-names.ts`);
  }
  return encontrada;
}

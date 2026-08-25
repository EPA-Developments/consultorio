// Bajar el contenido de un Binary de Medplum sin romper la firma del bucket.
//
// El servidor NO devuelve `Binary/<id>` en los Attachment: los reescribe a una
// URL de S3 ya firmada (X-Amz-Signature, con vencimiento). Esa URL trae su
// autenticación en el query string, así que agregarle el header Authorization
// —que es lo que hace `medplum.download()`— la invalida:
//
//   InvalidArgument: Only one auth mechanism allowed; only the X-Amz-Algorithm
//   query parameter, Signature query string parameter or the Authorization
//   header should be specified
//
// S3 devuelve ese error como un XML en el cuerpo, así que el diagnóstico que lo
// leía creía estar mirando el código del bot y lo declaraba "viejo". El
// problema nunca estuvo en el servidor ni en el bot: estaba acá.
import type { MedplumClient } from '@medplum/core';

/** true si la URL ya lleva su propia autenticación en el query string. */
export function esUrlFirmada(url: string): boolean {
  return /[?&](X-Amz-Signature|X-Amz-Algorithm|Signature)=/i.test(url);
}

/**
 * El contenido de un Binary como texto.
 *
 * Una URL firmada se pide PELADA (sin Authorization); el resto va por el
 * cliente de Medplum, que sí necesita el token.
 */
export async function descargarTexto(medplum: MedplumClient, url: string): Promise<string> {
  if (esUrlFirmada(url)) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} al bajar la URL firmada`);
    }
    return res.text();
  }
  return (await medplum.download(url)).text();
}

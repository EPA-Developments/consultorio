// Detecta que una descarga de Binary devolvió un error del storage en vez del
// contenido.
//
// `medplum.download()` sigue el redirect a la URL firmada del bucket. Cuando el
// objeto no está o la firma no vale, S3 (o MinIO) contesta un XML de error con
// status 200 en el cuerpo, y el cliente lo entrega como si fuera el archivo.
// Sin este chequeo, comparar ese XML contra el código del repo da "DISTINTO" y
// manda a redesplegar un bot que quizás está perfecto: el problema no es el
// código, es que no se puede leer.
export interface ErrorDeStorage {
  /** Código de error del bucket (AccessDenied, NoSuchKey, ...). */
  code?: string;
  message?: string;
}

/** El error del storage, o undefined si el cuerpo es contenido de verdad. */
export function errorDeStorage(cuerpo: string): ErrorDeStorage | undefined {
  const inicio = cuerpo.trimStart();
  if (!inicio.startsWith('<?xml') && !inicio.startsWith('<Error')) {
    return undefined;
  }
  return {
    code: /<Code>([^<]*)<\/Code>/.exec(cuerpo)?.[1],
    message: /<Message>([^<]*)<\/Message>/.exec(cuerpo)?.[1],
  };
}

/** Una línea para el log, lista para imprimir. */
export function describirErrorDeStorage(err: ErrorDeStorage): string {
  const partes = [err.code, err.message].filter(Boolean);
  return partes.length > 0 ? partes.join(': ') : 'el storage devolvió un XML de error sin detalle';
}

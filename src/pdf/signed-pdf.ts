// Lectura y verificación de un PDF firmado en firmar.gob.ar.
//
// Qué es un PDF firmado, estructuralmente: el archivo original SIN TOCAR, más
// una actualización incremental al final con el campo de firma y el PKCS#7.
// Verificado contra un documento real firmado por la Plataforma de Firma
// Digital Remota (AC MODERNIZACION-PFDR, agosto 2026): los 6.367 bytes del PDF
// que generamos aparecen byte a byte como PREFIJO EXACTO del archivo firmado.
//
// De ahí sale la verificación más fuerte que tenemos, y es casi gratis: como
// nuestra generación es determinista, se regenera el PDF de la receta y se
// compara contra el principio del firmado. Si coincide, el documento que
// alguien firmó es exactamente el que emitimos, sin una coma cambiada.
//
// ⚠️ ALCANCE — leer antes de confiar en esto:
// Esto NO valida criptográficamente la firma. No verifica la cadena de
// certificación, ni la revocación (CRL/OCSP), ni que la firma matemática
// corresponda a la clave del titular. Eso lo hace el validador oficial
// (firmar.gob.ar → "Validar documento"). Lo que sí prueba, y no es poco:
//   1. que el contenido firmado es EL NUESTRO (prefijo exacto);
//   2. que la firma cubre TODO el archivo (nada colado afuera del ByteRange);
//   3. que el resumen firmado coincide con los bytes (no se alteró después);
//   4. que el CUIL del firmante es el del profesional que prescribió.
// Nunca declarar "firma válida" con esto solo: sería declarar lo que no se
// probó, que es la regla de todo el módulo de emisión.

/** OIDs que se buscan dentro del PKCS#7, en sus bytes DER. */
const OID = {
  /** 2.5.4.5 — serialNumber del sujeto: donde la AC pone "CUIL nnnnnnnnnnn". */
  serialNumber: Buffer.from([0x06, 0x03, 0x55, 0x04, 0x05]),
  /** 2.5.4.3 — commonName. */
  commonName: Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]),
  /** 1.2.840.113549.1.9.4 — messageDigest (atributo firmado). */
  messageDigest: Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]),
} as const;

/** Tags DER de cadena de texto que aparecen en un Distinguished Name. */
const TAGS_TEXTO = new Set([0x0c, 0x13, 0x16, 0x1e]);

export interface SignedPdfInfo {
  /** El ByteRange declarado: [inicio1, largo1, inicio2, largo2]. */
  byteRange: [number, number, number, number];
  /** Bytes efectivamente firmados (los dos tramos, sin el hueco del PKCS#7). */
  signedBytes: Buffer;
  /** El PKCS#7 en DER. */
  pkcs7: Buffer;
  /** adbe.pkcs7.detached, ETSI.CAdES.detached, … */
  subFilter?: string;
  /** Momento de firma declarado (`/M`), tal cual viene. */
  signingTime?: string;
  /** La firma cubre el archivo entero (no hay bytes fuera del ByteRange). */
  cubreTodoElArchivo: boolean;
}

/**
 * Lee la estructura de firma de un PDF. Devuelve undefined si no tiene firma
 * o si el ByteRange no es coherente con el archivo.
 */
export function parseSignedPdf(pdf: Uint8Array): SignedPdfInfo | undefined {
  const buf = Buffer.from(pdf);
  const texto = buf.toString('latin1');

  const mRange = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(texto);
  if (!mRange) {
    return undefined;
  }
  const [i1, l1, i2, l2] = mRange.slice(1, 5).map(Number) as [number, number, number, number];
  if (i1 !== 0 || l1 <= 0 || i2 < l1 || i2 + l2 > buf.length) {
    return undefined;
  }

  // El PKCS#7 vive en el hueco entre los dos tramos, como cadena hexadecimal.
  const hueco = buf.subarray(l1, i2).toString('latin1');
  const mHex = /<([0-9a-fA-F]+)/.exec(hueco);
  if (!mHex) {
    return undefined;
  }
  const hex = mHex[1];
  const pkcs7 = Buffer.from(hex.slice(0, hex.length - (hex.length % 2)), 'hex');

  return {
    byteRange: [i1, l1, i2, l2],
    signedBytes: Buffer.concat([buf.subarray(i1, i1 + l1), buf.subarray(i2, i2 + l2)]),
    pkcs7,
    subFilter: /\/SubFilter\s*\/([A-Za-z0-9.]+)/.exec(texto)?.[1],
    signingTime: /\/M\s*\(([^)]*)\)/.exec(texto)?.[1],
    cubreTodoElArchivo: i2 + l2 === buf.length,
  };
}

/**
 * CUILs que aparecen como `serialNumber` en los certificados del PKCS#7. La AC
 * de la Plataforma de Firma Digital Remota los escribe con el prefijo "CUIL ".
 * Se devuelven todos los que haya (la cadena trae más de un certificado) y el
 * llamador chequea pertenencia; no se adivina cuál es el del firmante.
 */
export function cuilsDelCertificado(pkcs7: Buffer): string[] {
  return atributosDe(pkcs7, OID.serialNumber)
    .map((v) => /^CUIL\s*(\d{11})$/.exec(v.trim())?.[1])
    .filter((v): v is string => Boolean(v));
}

/** Nombres (commonName) que aparecen en los certificados del PKCS#7. */
export function nombresDelCertificado(pkcs7: Buffer): string[] {
  return atributosDe(pkcs7, OID.commonName);
}

/**
 * Verifica que el resumen firmado corresponda a los bytes del documento: el
 * atributo messageDigest del PKCS#7 contra el SHA-256 de lo que cubre el
 * ByteRange. Detecta una alteración posterior a la firma.
 *
 * Devuelve undefined si no encuentra el atributo (no se puede afirmar nada).
 */
export async function resumenCoincide(info: SignedPdfInfo): Promise<boolean | undefined> {
  const digests = atributosBinariosDe(info.pkcs7, OID.messageDigest);
  if (digests.length === 0) {
    return undefined;
  }
  // Web Crypto, no el crypto de Node: esto corre en el navegador.
  const sha256 = await sha256Bytes(info.signedBytes);
  return digests.some((d) => d.toString('hex') === sha256);
}

/** SHA-256 con Web Crypto (navegador y Node ≥18), en hexadecimal. */
async function sha256Bytes(bytes: Buffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VerificacionPdfFirmado {
  /** Tiene estructura de firma legible. */
  tieneFirma: boolean;
  /** El PDF que emitimos es prefijo exacto del firmado: el contenido es el nuestro. */
  contenidoEsElNuestro: boolean;
  /** La firma cubre todo el archivo: no hay nada agregado por fuera. */
  cubreTodoElArchivo: boolean;
  /** El resumen firmado coincide con los bytes. undefined = no se pudo leer. */
  resumenCoincide?: boolean;
  /** CUIL del firmante, si coincide con alguno de los esperados. */
  cuilFirmante?: string;
  /** El firmante es el profesional que prescribió. undefined = no se verificó. */
  firmanteEsElPrescriptor?: boolean;
  /** Momento de firma declarado en el PDF. */
  firmadoEl?: string;
  /** Qué falló, en castellano, para poder mostrarlo. */
  problemas: string[];
}

/**
 * Verifica un PDF firmado contra el que emitimos.
 *
 * `esperado` son los bytes regenerados de la MISMA receta: por eso la
 * generación tiene que ser determinista, y por eso hay un test que lo cuida.
 */
export async function verificarPdfFirmado(params: {
  firmado: Uint8Array;
  esperado: Uint8Array;
  /** CUIL del prescriptor (solo dígitos), para el cotejo de identidad. */
  cuilEsperado?: string;
}): Promise<VerificacionPdfFirmado> {
  const { firmado, esperado } = params;
  const problemas: string[] = [];
  const info = parseSignedPdf(firmado);

  if (!info) {
    return {
      tieneFirma: false,
      contenidoEsElNuestro: false,
      cubreTodoElArchivo: false,
      problemas: ['El archivo no tiene una firma digital legible.'],
    };
  }

  const contenidoEsElNuestro =
    firmado.length >= esperado.length && Buffer.from(firmado.subarray(0, esperado.length)).equals(Buffer.from(esperado));
  if (!contenidoEsElNuestro) {
    problemas.push('El documento firmado no coincide con la receta emitida.');
  }
  if (!info.cubreTodoElArchivo) {
    problemas.push('La firma no cubre todo el archivo: hay contenido agregado por fuera.');
  }
  const resumen = await resumenCoincide(info);
  if (resumen === false) {
    problemas.push('El resumen firmado no coincide con el contenido: el archivo fue alterado después de firmarse.');
  }

  const cuils = cuilsDelCertificado(info.pkcs7);
  const cuilEsperado = params.cuilEsperado?.replace(/\D/g, '');
  const cuilFirmante = cuilEsperado ? cuils.find((c) => c === cuilEsperado) : cuils[0];
  const firmanteEsElPrescriptor = cuilEsperado ? cuils.includes(cuilEsperado) : undefined;
  if (firmanteEsElPrescriptor === false) {
    problemas.push('El CUIL del firmante no es el del profesional que prescribió.');
  }

  return {
    tieneFirma: true,
    contenidoEsElNuestro,
    cubreTodoElArchivo: info.cubreTodoElArchivo,
    resumenCoincide: resumen,
    cuilFirmante,
    firmanteEsElPrescriptor,
    firmadoEl: info.signingTime,
    problemas,
  };
}

// ── Lectura mínima de DER ───────────────────────────────────────────────────
//
// No es un parser de ASN.1 completo y no pretende serlo. Aprovecha una
// garantía estructural de X.501: en un AttributeTypeAndValue el valor va
// INMEDIATAMENTE después del OID del tipo. Así que ubicar el OID y leer el TLV
// siguiente alcanza, sin recorrer el certificado entero.

function atributosDe(der: Buffer, oid: Buffer): string[] {
  return valoresTrasOid(der, oid)
    .filter((v) => TAGS_TEXTO.has(v.tag))
    .map((v) => v.value.toString('utf8'));
}

function atributosBinariosDe(der: Buffer, oid: Buffer): Buffer[] {
  // messageDigest viene como SET { OCTET STRING }: se salta el SET.
  return valoresTrasOid(der, oid).flatMap((v) => {
    if (v.tag === 0x04) {
      return [v.value];
    }
    if (v.tag === 0x31) {
      const interno = leerTlv(v.value, 0);
      return interno && interno.tag === 0x04 ? [interno.value] : [];
    }
    return [];
  });
}

function valoresTrasOid(der: Buffer, oid: Buffer): { tag: number; value: Buffer }[] {
  const out: { tag: number; value: Buffer }[] = [];
  let desde = 0;
  for (;;) {
    const i = der.indexOf(oid, desde);
    if (i === -1) {
      return out;
    }
    const tlv = leerTlv(der, i + oid.length);
    if (tlv) {
      out.push({ tag: tlv.tag, value: tlv.value });
    }
    desde = i + oid.length;
  }
}

/** Lee un TLV DER en `pos`. Soporta longitud corta y larga. */
function leerTlv(der: Buffer, pos: number): { tag: number; value: Buffer; fin: number } | undefined {
  if (pos + 1 >= der.length) {
    return undefined;
  }
  const tag = der[pos];
  const primerLargo = der[pos + 1];
  let largo: number;
  let inicio: number;
  if (primerLargo < 0x80) {
    largo = primerLargo;
    inicio = pos + 2;
  } else {
    const bytesDeLargo = primerLargo & 0x7f;
    if (bytesDeLargo === 0 || bytesDeLargo > 4 || pos + 2 + bytesDeLargo > der.length) {
      return undefined;
    }
    largo = 0;
    for (let k = 0; k < bytesDeLargo; k++) {
      largo = largo * 256 + der[pos + 2 + k];
    }
    inicio = pos + 2 + bytesDeLargo;
  }
  if (inicio + largo > der.length) {
    return undefined;
  }
  return { tag, value: der.subarray(inicio, inicio + largo), fin: inicio + largo };
}

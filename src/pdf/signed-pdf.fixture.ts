// Constructor de PDFs firmados para los TESTS.
//
// Un PDF firmado de verdad lleva el CUIL, el correo y el certificado de una
// persona real: eso no se versiona. Acá se reproduce la ESTRUCTURA que se
// verificó contra un documento real firmado por la Plataforma de Firma Digital
// Remota (agosto 2026): el archivo original intacto como prefijo, más una
// actualización incremental con el campo de firma y el PKCS#7 en /Contents.
//
// Solo lo importan los tests; no entra en el bundle de la aplicación.
import { createHash } from 'crypto';

/** El CUIL que usan los tests como el del profesional que prescribe. */
export const CUIL_MEDICO_TEST = '20205419935';

/** TLV DER con longitud corta (alcanza para el fixture). */
function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

const OID_SERIAL = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x05]);
const OID_CN = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
const OID_MSGDIGEST = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);

function der(digest: Buffer, cuil: string, nombre: string): Buffer {
  return Buffer.concat([
    OID_CN,
    tlv(0x0c, Buffer.from('AC MODERNIZACION-PFDR', 'utf8')),
    OID_SERIAL,
    tlv(0x13, Buffer.from(`CUIL ${cuil}`, 'utf8')),
    OID_CN,
    tlv(0x0c, Buffer.from(nombre, 'utf8')),
    OID_MSGDIGEST,
    tlv(0x31, tlv(0x04, digest)),
  ]);
}

/**
 * Firma "a la manera del Firmador": deja el original intacto y le agrega la
 * actualización incremental. El resumen se calcula en dos pasadas porque el
 * DER tiene largo fijo: primero con un relleno, después con el real.
 */
export function firmarComoElFirmador(base: Uint8Array, cuil = CUIL_MEDICO_TEST, nombre = 'Dra Test'): Buffer {
  const armar = (blob: Buffer): { archivo: Buffer; firmados: Buffer } => {
    const hex = blob.toString('hex');
    const cabeza = Buffer.concat([
      Buffer.from(base),
      Buffer.from("\n8 0 obj\n<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/adbe.pkcs7.detached/M(D:20260818222024-03'00')/Contents "),
    ]);
    const l1 = cabeza.length;
    const i2 = l1 + hex.length + 2; // '<' + hex + '>'
    // Anchos fijos para que el ByteRange no cambie de largo al recalcularse.
    const num = (n: number): string => String(n).padStart(10, '0');
    const cola = Buffer.from(`/ByteRange[${num(0)} ${num(l1)} ${num(i2)} ${num(0)}]>>\nendobj\n%%EOF\n`);
    const l2 = cola.length;
    const colaFinal = Buffer.from(`/ByteRange[${num(0)} ${num(l1)} ${num(i2)} ${num(l2)}]>>\nendobj\n%%EOF\n`);
    const archivo = Buffer.concat([cabeza, Buffer.from(`<${hex}>`), colaFinal]);
    return { archivo, firmados: Buffer.concat([archivo.subarray(0, l1), archivo.subarray(i2, i2 + l2)]) };
  };

  const conRelleno = armar(der(Buffer.alloc(32), cuil, nombre));
  const digest = createHash('sha256').update(conRelleno.firmados).digest();
  return armar(der(digest, cuil, nombre)).archivo;
}

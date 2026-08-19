import type {
  Binary,
  Bundle,
  DocumentReference,
  MedicationRequest,
  Patient,
  Practitioner,
  Provenance,
  Resource,
} from '@medplum/fhirtypes';
import { CUIL_MEDICO_TEST, firmarComoElFirmador } from '../pdf/signed-pdf.fixture';
import { renderRecetaPdf } from './receta-pdf';
import type { RecetaPrintData } from './receta-print';
import {
  buildRecetaFirmadaBundle,
  fechaPdfAIso,
  guardarRecetaFirmada,
  RecetaFirmadaRechazadaError,
  SIG_FORMAT_PKCS7,
} from './receta-firmada';
import { SELLO_RECETA_SYSTEM } from './receta-emision';
import { RECETA_SYSTEM } from './receta';

const PACIENTE: Patient = { resourceType: 'Patient', id: 'p1' };
const MEDICO: Practitioner = {
  resourceType: 'Practitioner',
  id: 'dr1',
  name: [{ given: ['Alejandro'], family: "D'Alessandro" }],
  identifier: [
    { system: 'http://refeps.msal.gob.ar', value: 'MN-92179' },
    { system: 'http://afip.gob.ar', value: '20-20541993-5' },
  ],
};
const REQUESTS: MedicationRequest[] = [
  {
    resourceType: 'MedicationRequest',
    id: 'mr1',
    status: 'active',
    intent: 'order',
    subject: { reference: 'Patient/p1' },
    groupIdentifier: { system: RECETA_SYSTEM, value: 'REC-B8B1B5DF' },
    identifier: [{ system: SELLO_RECETA_SYSTEM, value: 'a'.repeat(64) }],
    medicationCodeableConcept: { text: 'rosuvastatina — comprimidos 5 mg' },
    authoredOn: '2026-08-11T12:00:00Z',
  },
];
const DATA: RecetaPrintData = {
  clinicName: 'Favaloro | Medplum Argentina',
  patientName: 'Marice Bourdon',
  practitionerName: "Dr Alejandro D'Alessandro",
  practitionerMatricula: 'MN-92179',
  recetaId: 'REC-B8B1B5DF',
  authoredOn: '2026-08-11T12:00:00Z',
  items: [{ medicamento: 'rosuvastatina — comprimidos 5 mg', cantidad: 1 }],
};

function recursos<T extends Resource>(bundle: Bundle, tipo: T['resourceType']): T[] {
  return (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is T => r !== undefined && r.resourceType === tipo);
}

describe('Fecha de firma del PDF', () => {
  test('convierte el formato de PDF a ISO, con huso', () => {
    // El Firmador escribe la hora local argentina con su offset.
    expect(fechaPdfAIso("D:20260818222024-03'00'")).toBe('2026-08-19T01:20:24.000Z');
  });

  test('acepta Z y sin huso', () => {
    expect(fechaPdfAIso('D:20260818222024Z')).toBe('2026-08-18T22:20:24.000Z');
    expect(fechaPdfAIso('D:20260818222024')).toBe('2026-08-18T22:20:24.000Z');
  });

  // Preferimos no registrar fecha antes que registrar una inventada.
  test('lo que no tiene la forma esperada no se adivina', () => {
    expect(fechaPdfAIso('18/08/2026')).toBeUndefined();
    expect(fechaPdfAIso(undefined)).toBeUndefined();
    expect(fechaPdfAIso('D:20261398222024')).toBeUndefined();
  });
});

describe('Transacción de la receta firmada', () => {
  const bundle = buildRecetaFirmadaBundle({
    recetaId: 'REC-B8B1B5DF',
    requests: REQUESTS,
    patient: PACIENTE,
    practitioner: MEDICO,
    binaryUrl: 'Binary/bin1',
    filename: 'Receta-REC-B8B1B5DF-MariceBourdon.pdf',
    signatureData: 'ZmFrZS1wa2NzNw==',
    firmadoEl: '2026-08-19T01:20:24.000Z',
  });

  test('el documento apunta al PDF y a la receta que firma', () => {
    const [doc] = recursos<DocumentReference>(bundle, 'DocumentReference');
    expect(doc.content[0].attachment.url).toBe('Binary/bin1');
    expect(doc.content[0].attachment.contentType).toBe('application/pdf');
    expect(doc.identifier?.[0]).toStrictEqual({ system: RECETA_SYSTEM, value: 'REC-B8B1B5DF' });
    expect(doc.context?.related).toStrictEqual([{ reference: 'MedicationRequest/mr1' }]);
    expect(doc.docStatus).toBe('final');
  });

  // Signature.data estaba modelado y vacío desde que se escribió el módulo de
  // emisión: acá deja de estarlo, con la firma real de la AC del Estado.
  test('la firma real viaja en el Provenance', () => {
    const [prov] = recursos<Provenance>(bundle, 'Provenance');
    expect(prov.signature?.[0].data).toBe('ZmFrZS1wa2NzNw==');
    expect(prov.signature?.[0].sigFormat).toBe(SIG_FORMAT_PKCS7);
    expect(prov.signature?.[0].targetFormat).toBe('application/pdf');
    expect(prov.signature?.[0].when).toBe('2026-08-19T01:20:24.000Z');
    expect(prov.signature?.[0].who.reference).toBe('Practitioner/dr1');
  });

  test('el Provenance apunta a la receta Y al documento de la misma transacción', () => {
    const [prov] = recursos<Provenance>(bundle, 'Provenance');
    const docUrn = bundle.entry?.find((e) => e.resource?.resourceType === 'DocumentReference')?.fullUrl;
    expect(prov.target.map((t) => t.reference)).toStrictEqual(['MedicationRequest/mr1', docUrn]);
  });

  // Un documento firmado sin su registro de firma, o al revés, es peor que
  // ninguno de los dos: van en la misma transacción.
  test('documento y firma van juntos, en una sola transacción', () => {
    expect(bundle.type).toBe('transaction');
    expect(bundle.entry).toHaveLength(2);
  });
});

describe('Guardado con verificación previa', () => {
  function fakeMedplum(): { medplum: any; batches: Bundle[]; binarios: unknown[] } {
    const batches: Bundle[] = [];
    const binarios: unknown[] = [];
    return {
      batches,
      binarios,
      medplum: {
        createBinary: async (args: unknown) => {
          binarios.push(args);
          return { resourceType: 'Binary', id: 'bin1' } as Binary;
        },
        executeBatch: async (b: Bundle) => {
          batches.push(b);
          return b;
        },
      },
    };
  }

  test('un PDF firmado que corresponde a la receta se guarda', async () => {
    const esperado = await renderRecetaPdf(DATA);
    const ctx = fakeMedplum();
    const r = await guardarRecetaFirmada(ctx.medplum, {
      recetaId: 'REC-B8B1B5DF',
      requests: REQUESTS,
      patient: PACIENTE,
      practitioner: MEDICO,
      firmado: firmarComoElFirmador(esperado),
      esperado,
      filename: 'Receta-REC-B8B1B5DF-MariceBourdon.pdf',
    });

    expect(r.verificacion.problemas).toStrictEqual([]);
    expect(r.verificacion.cuilFirmante).toBe(CUIL_MEDICO_TEST);
    expect(ctx.binarios).toHaveLength(1);
    expect(ctx.batches).toHaveLength(1);
    // El PKCS#7 real termina en Signature.data, no un texto de relleno.
    const [prov] = recursos<Provenance>(ctx.batches[0], 'Provenance');
    expect((prov.signature?.[0].data ?? '').length).toBeGreaterThan(50);
  });

  // Primero verificar, después escribir. Un PDF que no corresponde a la receta
  // quedaría exhibido como SU documento legal: no se guarda nada.
  test('un PDF de otra receta se rechaza y NO escribe nada', async () => {
    const ctx = fakeMedplum();
    await expect(
      guardarRecetaFirmada(ctx.medplum, {
        recetaId: 'REC-B8B1B5DF',
        requests: REQUESTS,
        patient: PACIENTE,
        practitioner: MEDICO,
        firmado: firmarComoElFirmador(await renderRecetaPdf({ ...DATA, recetaId: 'REC-OTRA' })),
        esperado: await renderRecetaPdf(DATA),
        filename: 'x.pdf',
      })
    ).rejects.toThrow(RecetaFirmadaRechazadaError);
    expect(ctx.binarios).toStrictEqual([]);
    expect(ctx.batches).toStrictEqual([]);
  });

  test('un PDF sin firma se rechaza', async () => {
    const esperado = await renderRecetaPdf(DATA);
    const ctx = fakeMedplum();
    await expect(
      guardarRecetaFirmada(ctx.medplum, {
        recetaId: 'REC-B8B1B5DF',
        requests: REQUESTS,
        patient: PACIENTE,
        practitioner: MEDICO,
        firmado: esperado,
        esperado,
        filename: 'x.pdf',
      })
    ).rejects.toThrow(/no tiene una firma digital/);
    expect(ctx.batches).toStrictEqual([]);
  });

  test('firmado por otro profesional: se rechaza por CUIL', async () => {
    const esperado = await renderRecetaPdf(DATA);
    const ctx = fakeMedplum();
    await expect(
      guardarRecetaFirmada(ctx.medplum, {
        recetaId: 'REC-B8B1B5DF',
        requests: REQUESTS,
        patient: PACIENTE,
        practitioner: MEDICO,
        firmado: firmarComoElFirmador(esperado, '27123456789', 'Otro'),
        esperado,
        filename: 'x.pdf',
      })
    ).rejects.toThrow(/CUIL del firmante/);
    expect(ctx.batches).toStrictEqual([]);
  });
});

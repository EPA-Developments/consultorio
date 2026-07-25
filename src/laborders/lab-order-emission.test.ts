import type { Practitioner, ServiceRequest } from '@medplum/fhirtypes';
import { MATRICULA_SYSTEM } from '../ckm/argentina';
import {
  buildEmissionProvenance,
  canonicalOrderContent,
  CUIR_SYSTEM,
  emissionStatusOf,
  EMISSION_STATUS,
  getCuir,
  getSello,
  practitionerMatricula,
  retentionUntil,
  sealOrder,
  SELLO_SYSTEM,
  verificationUrl,
  verifySeal,
  withSeal,
} from './lab-order-emission';
import { REQUISITION_SYSTEM } from './lab-order';

function sr(code: string, text: string, extra: Partial<ServiceRequest> = {}): ServiceRequest {
  return {
    resourceType: 'ServiceRequest',
    id: `sr-${code}`,
    status: 'active',
    intent: 'order',
    subject: { reference: 'Patient/p1' },
    requester: { reference: 'Practitioner/dr1' },
    authoredOn: '2026-07-24T10:00:00Z',
    requisition: { system: REQUISITION_SYSTEM, value: 'ORD-1' },
    code: { coding: [{ system: 'http://loinc.org', code }], text },
    ...extra,
  };
}

const practitioner: Practitioner = {
  resourceType: 'Practitioner',
  id: 'dr1',
  name: [{ given: ['Alejandro'], family: "D'Alessandro", prefix: ['Dr.'] }],
  identifier: [{ system: MATRICULA_SYSTEM, value: 'MN 98765' }],
};

describe('Sello de integridad', () => {
  test('el contenido canónico es determinista sin importar el orden de los estudios', () => {
    const a = canonicalOrderContent([sr('1558-6', 'Glucosa'), sr('27353-2', 'Insulina')]);
    const b = canonicalOrderContent([sr('27353-2', 'Insulina'), sr('1558-6', 'Glucosa')]);
    expect(a).toBe(b);
  });

  test('mismo pedido → mismo sello', async () => {
    const s1 = await sealOrder([sr('1558-6', 'Glucosa'), sr('27353-2', 'Insulina')]);
    const s2 = await sealOrder([sr('27353-2', 'Insulina'), sr('1558-6', 'Glucosa')]);
    expect(s1).toBe(s2);
    expect(s1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  test('AGREGAR un estudio cambia el sello (detecta adulteración)', async () => {
    const original = [sr('1558-6', 'Glucosa')];
    const alterada = [sr('1558-6', 'Glucosa'), sr('2085-9', 'HDL')];
    expect(await sealOrder(original)).not.toBe(await sealOrder(alterada));
  });

  test('cambiar el paciente cambia el sello', async () => {
    const a = [sr('1558-6', 'Glucosa')];
    const b = [sr('1558-6', 'Glucosa', { subject: { reference: 'Patient/OTRO' } })];
    expect(await sealOrder(a)).not.toBe(await sealOrder(b));
  });

  test('verifySeal: true si no cambió, false si la alteraron', async () => {
    const requests = [sr('1558-6', 'Glucosa')];
    const seal = await sealOrder(requests);
    const sealed = requests.map((r) => ({ ...r, identifier: withSeal(r, seal) }));
    expect(await verifySeal(sealed)).toBe(true);

    const tampered = [...sealed, sr('2085-9', 'HDL')];
    expect(await verifySeal(tampered)).toBe(false);
  });

  test('verifySeal: false si no hay sello guardado', async () => {
    expect(await verifySeal([sr('1558-6', 'Glucosa')])).toBe(false);
  });

  test('withSeal no duplica el sello al re-firmar', () => {
    const r = sr('1558-6', 'Glucosa');
    const once = { ...r, identifier: withSeal(r, 'aaa') };
    const twice = withSeal(once, 'bbb');
    expect(twice?.filter((i) => i.system === SELLO_SYSTEM)).toHaveLength(1);
    expect(getSello({ ...r, identifier: twice })).toBe('bbb');
  });
});

describe('Estado de emisión', () => {
  test('sin firma ni sello → borrador', () => {
    expect(emissionStatusOf(sr('1558-6', 'Glucosa'), false)).toBe('draft');
  });

  test('con firma y sello → firmada (todavía NO legalmente emitida)', () => {
    const r = sr('1558-6', 'Glucosa');
    const sealed = { ...r, identifier: withSeal(r, 'abc') };
    expect(emissionStatusOf(sealed, true)).toBe('signed-internal');
  });

  test('firma sin sello NO alcanza para "firmada"', () => {
    expect(emissionStatusOf(sr('1558-6', 'Glucosa'), true)).toBe('draft');
  });

  test('con CUIR asignado → emitida legalmente', () => {
    const r = sr('1558-6', 'Glucosa', { identifier: [{ system: CUIR_SYSTEM, value: 'CUIR-123' }] });
    expect(emissionStatusOf(r, true)).toBe('legally-emitted');
    expect(getCuir(r)).toBe('CUIR-123');
  });

  test('las leyendas dicen la verdad sobre la validez', () => {
    expect(EMISSION_STATUS.draft.legend).toMatch(/no constituye/i);
    expect(EMISSION_STATUS['signed-internal'].legend).toMatch(/pendiente de emisión/i);
    expect(EMISSION_STATUS['legally-emitted'].legend).toMatch(/ReNaPDiS/);
  });
});

describe('Provenance de la firma', () => {
  const requests = [sr('1558-6', 'Glucosa'), sr('27353-2', 'Insulina')];
  const prov = buildEmissionProvenance({
    requests,
    practitioner,
    when: '2026-07-24T12:00:00Z',
    seal: 'abc123',
    signatureData: 'ZmFrZQ==',
    sigFormat: 'application/pkcs7-signature',
  });

  test('apunta a todas las órdenes de la requisición', () => {
    expect(prov.target).toHaveLength(2);
    expect(prov.target.map((t) => t.reference)).toContain('ServiceRequest/sr-1558-6');
  });

  test('registra quién firmó y cuándo', () => {
    expect(prov.recorded).toBe('2026-07-24T12:00:00Z');
    expect(prov.agent[0].who.reference).toBe('Practitioner/dr1');
    expect(prov.signature?.[0].when).toBe('2026-07-24T12:00:00Z');
    expect(prov.signature?.[0].who.display).toContain("D'Alessandro");
  });

  test('lleva la firma y su formato cuando se provee', () => {
    expect(prov.signature?.[0].data).toBe('ZmFrZQ==');
    expect(prov.signature?.[0].sigFormat).toBe('application/pkcs7-signature');
  });

  test('sin signatureData igual registra la autoría (firma electrónica simple)', () => {
    const p = buildEmissionProvenance({ requests, practitioner, when: '2026-07-24T12:00:00Z', seal: 'abc' });
    expect(p.signature?.[0].data).toBeUndefined();
    expect(p.signature?.[0].who.reference).toBe('Practitioner/dr1');
  });

  test('guarda el sello para auditar', () => {
    expect(prov.extension?.find((e) => e.url === SELLO_SYSTEM)?.valueString).toBe('abc123');
  });
});

describe('Verificación y retención', () => {
  test('URL de verificación usa el CUIR si existe', () => {
    const r = sr('1558-6', 'Glucosa', { identifier: [{ system: CUIR_SYSTEM, value: 'CUIR-9' }] });
    expect(verificationUrl([r])).toContain('cuir=CUIR-9');
  });

  test('sin CUIR cae al número de orden propio', () => {
    expect(verificationUrl([sr('1558-6', 'Glucosa')])).toContain('orden=ORD-1');
  });

  test('matrícula del profesional', () => {
    expect(practitionerMatricula(practitioner)).toBe('MN 98765');
    expect(practitionerMatricula(undefined)).toBeUndefined();
  });

  test('retención: 3 años desde la emisión', () => {
    expect(retentionUntil('2026-07-24T10:00:00Z')).toBe('2029-07-24');
    expect(retentionUntil('no-es-fecha')).toBeUndefined();
  });
});

import type { MedicationRequest, Practitioner } from '@medplum/fhirtypes';
import { CUIR_SYSTEM } from '../laborders/lab-order-emission';
import {
  buildRecetaProvenance,
  canonicalRecetaContent,
  conSelloReceta,
  emissionStatusOfReceta,
  getSelloReceta,
  SELLO_RECETA_SYSTEM,
  sellarReceta,
  verificarSelloReceta,
} from './receta-emision';

function mr(med: string, posologia = '1 por día', cantidad = 1): MedicationRequest {
  return {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    subject: { reference: 'Patient/p1' },
    requester: { reference: 'Practitioner/dr1' },
    groupIdentifier: { system: 'https://bio.medplum.com.ar/fhir/sid/receta', value: 'REC-A' },
    authoredOn: '2026-08-11T12:00:00Z',
    medicationCodeableConcept: { text: med },
    dosageInstruction: [{ text: posologia }],
    dispenseRequest: { quantity: { value: cantidad } },
  };
}

describe('Contenido canónico y sello de la receta', () => {
  test('el orden de los ítems no cambia el sello', async () => {
    const s1 = await sellarReceta([mr('metformina'), mr('rosuvastatina')]);
    const s2 = await sellarReceta([mr('rosuvastatina'), mr('metformina')]);
    expect(s1).toBe(s2);
  });

  // El sello existe para esto: cualquier cambio clínico lo invalida.
  test('cambiar la posología o la cantidad cambia el sello', async () => {
    const base = await sellarReceta([mr('metformina', '1 por día', 1)]);
    expect(await sellarReceta([mr('metformina', '2 por día', 1)])).not.toBe(base);
    expect(await sellarReceta([mr('metformina', '1 por día', 2)])).not.toBe(base);
  });

  test('receta vacía sella vacío', () => {
    expect(canonicalRecetaContent([])).toBe('');
  });

  test('verificarSelloReceta detecta la adulteración', async () => {
    const receta = [mr('metformina')];
    const seal = await sellarReceta(receta);
    const selladas = receta.map((r) => ({ ...r, identifier: conSelloReceta(r, seal) }));
    expect(await verificarSelloReceta(selladas)).toBe(true);
    const adulteradas = selladas.map((r) => ({ ...r, dosageInstruction: [{ text: '99 por día' }] }));
    expect(await verificarSelloReceta(adulteradas)).toBe(false);
    expect(await verificarSelloReceta([mr('metformina')])).toBe(false); // sin sello
  });

  test('conSelloReceta no duplica el sello ni pisa otros identifiers', () => {
    const r = { ...mr('metformina'), identifier: [{ system: 'otro', value: 'x' }] };
    const una = conSelloReceta(r, 'abc');
    const dos = conSelloReceta({ ...r, identifier: una }, 'def');
    expect(dos.filter((i) => i.system === SELLO_RECETA_SYSTEM)).toHaveLength(1);
    expect(dos.find((i) => i.system === SELLO_RECETA_SYSTEM)?.value).toBe('def');
    expect(dos.find((i) => i.system === 'otro')?.value).toBe('x');
  });
});

describe('Provenance de la firma', () => {
  const practitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: 'dr1',
    name: [{ prefix: ['Dr'], given: ['Ana'], family: 'Prueba' }],
  };
  const prov = buildRecetaProvenance({
    targets: ['urn:uuid:1111', 'urn:uuid:2222'],
    practitioner,
    when: '2026-08-11T12:00:00Z',
    seal: 'sello-abc',
  });

  test('apunta a los targets (urns de la transacción) y registra al autor', () => {
    expect(prov.target?.map((t) => t.reference)).toStrictEqual(['urn:uuid:1111', 'urn:uuid:2222']);
    expect(prov.agent?.[0]?.who?.reference).toBe('Practitioner/dr1');
    expect(prov.agent?.[0]?.who?.display).toContain('Prueba');
  });

  test('la firma lleva quién y cuándo, y el sello viaja como extensión', () => {
    expect(prov.signature?.[0]?.when).toBe('2026-08-11T12:00:00Z');
    expect(prov.signature?.[0]?.who?.reference).toBe('Practitioner/dr1');
    expect(prov.extension?.find((e) => e.url === SELLO_RECETA_SYSTEM)?.valueString).toBe('sello-abc');
  });
});

describe('Estado de emisión de la receta', () => {
  test('sin nada es borrador; el documento no declara lo que no puede probar', () => {
    expect(emissionStatusOfReceta(mr('metformina'), false)).toBe('draft');
    // Firma sin sello tampoco alcanza.
    expect(emissionStatusOfReceta(mr('metformina'), true)).toBe('draft');
  });

  test('sello + firma registrada => firmada (signed-internal)', () => {
    const r = { ...mr('metformina'), identifier: conSelloReceta(mr('metformina'), 'abc') };
    expect(getSelloReceta(r)).toBe('abc');
    expect(emissionStatusOfReceta(r, true)).toBe('signed-internal');
    expect(emissionStatusOfReceta(r, false)).toBe('draft');
  });

  // NUNCA sin inscripción efectiva: el CUIR lo asigna el sistema nacional.
  test('solo el CUIR vuelve una receta legalmente emitida', () => {
    const r = { ...mr('metformina'), identifier: [{ system: CUIR_SYSTEM, value: 'CUIR-123' }] };
    expect(emissionStatusOfReceta(r, false)).toBe('legally-emitted');
  });
});

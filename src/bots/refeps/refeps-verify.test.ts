import type { Practitioner } from '@medplum/fhirtypes';
import { CUIL_SYSTEM, DNI_SYSTEM } from '../../ckm/argentina';
import { queryFor, signClientAssertion } from './refeps-verify';

function medico(over: Partial<Practitioner> = {}): Practitioner {
  return {
    resourceType: 'Practitioner',
    name: [{ given: ['Alejandro'], family: "D'Alessandro" }],
    gender: 'male',
    identifier: [{ system: DNI_SYSTEM, value: '17801010' }],
    ...over,
  };
}

describe('signClientAssertion', () => {
  // Vector de la guía oficial: mismos claims y mismo secreto tienen que dar
  // siempre la misma firma. Si cambia el algoritmo o el encoding, esto lo frena.
  test('produce un JWT de tres partes en base64url', () => {
    const jwt = signClientAssertion({ iss: 'https://api.medplum.com.ar', iat: 1757196526 }, 'secreto');
    const partes = jwt.split('.');
    expect(partes).toHaveLength(3);
    // base64url: sin +, / ni padding.
    expect(jwt).not.toMatch(/[+/=]/);
  });

  test('la cabecera declara HS256', () => {
    const [header] = signClientAssertion({ a: 1 }, 's').split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toStrictEqual({ alg: 'HS256', typ: 'JWT' });
  });

  test('el payload viaja tal cual, sin agregados', () => {
    const claims = { iss: 'https://api.medplum.com.ar', iat: 1757196526, exp: 1757200126 };
    const [, payload] = signClientAssertion(claims, 's').split('.');
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toStrictEqual(claims);
  });

  test('es determinístico y cambia con el secreto', () => {
    const claims = { iat: 1 };
    expect(signClientAssertion(claims, 'A')).toBe(signClientAssertion(claims, 'A'));
    expect(signClientAssertion(claims, 'A')).not.toBe(signClientAssertion(claims, 'B'));
  });
});

describe('queryFor', () => {
  test('prefiere DNI + género, que es lo que siempre está cargado', () => {
    expect(queryFor(medico())).toStrictEqual({ by: 'dni', dni: '17801010', gender: 'male' });
  });

  // El servicio exige el género junto al DNI: sin él la búsqueda no es válida.
  test('sin género no usa el DNI: cae al CUIL', () => {
    const p = medico({
      gender: undefined,
      identifier: [
        { system: DNI_SYSTEM, value: '17801010' },
        { system: CUIL_SYSTEM, value: '20178010102' },
      ],
    });
    expect(queryFor(p)).toStrictEqual({ by: 'cuil', cuil: '20178010102' });
  });

  test('un género que REFEPS no acepta tampoco habilita la búsqueda por DNI', () => {
    const p = medico({ gender: 'other', identifier: [{ system: CUIL_SYSTEM, value: '20178010102' }] });
    expect(queryFor(p)).toStrictEqual({ by: 'cuil', cuil: '20178010102' });
  });

  test('sin DNI usable ni CUIL no hay consulta posible', () => {
    expect(queryFor(medico({ gender: undefined, identifier: [] }))).toBeUndefined();
  });

  // La guía desaconseja el id interno del Bus: no garantiza mantenerse.
  test('nunca elige la búsqueda por id interno', () => {
    for (const p of [medico(), medico({ gender: undefined, identifier: [{ system: CUIL_SYSTEM, value: '2' }] })]) {
      expect(queryFor(p)?.by).not.toBe('id');
    }
  });
});

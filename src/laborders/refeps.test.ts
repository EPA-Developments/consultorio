import type { Bundle, Practitioner } from '@medplum/fhirtypes';
import {
  accessTokenFrom,
  buildAuthRequest,
  buildClientAssertionClaims,
  BUS_URLS,
  CLIENT_ASSERTION_TTL_SECONDS,
  dniOf,
  especialidadesOf,
  matriculaDigits,
  matriculaMatches,
  matriculasOf,
  normalizeCuil,
  practitionerSearchUrl,
  practitionersFrom,
  refepsCodeOf,
  REFEPS_SYSTEM,
  searchHeaders,
  verifyMatricula,
} from './refeps';

const AHORA = '2026-08-06T12:00:00.000Z';

/**
 * Respuesta REAL de la colección oficial (formato v1, capturada en 2021): la
 * matrícula se reconoce por `type.text === 'PRO'` y las especialidades son
 * qualifications aparte. Este profesional tiene DOS matrículas.
 */
const V1_BUNDLE = {
  resourceType: 'Bundle',
  type: 'searchset',
  total: 1,
  entry: [
    {
      fullUrl: 'https://bus-dev.msal.gob.ar/fhir/Practitioner/10003233',
      resource: {
        resourceType: 'Practitioner',
        id: '10003233',
        identifier: [
          { use: 'usual', type: { coding: [{ code: 'NI' }] }, system: REFEPS_SYSTEM, value: '541012497922' },
          { use: 'official', system: 'https://www.renaper.org.ar', value: '12497922' },
        ],
        active: true,
        name: [{ use: 'official', text: 'Tubau Cepeda', family: 'Cepeda', given: ['Tubau'] }],
        gender: 'female',
        birthDate: '1956-10-18',
        qualification: [
          {
            identifier: [{ use: 'official', type: { text: 'PRO' }, system: REFEPS_SYSTEM, value: '61177' }],
            code: { coding: [{ system: 'http://fhir.msal.gov.ar/ValueSet/Profesiones_REFEPS', code: '10003233', display: 'Médico' }] },
            period: { start: '1981-11-06T00:00:00-03:00' },
          },
          {
            identifier: [{ use: 'official', type: { text: 'ESP' }, assigner: { display: '8' } }],
            code: { coding: [{ display: 'Cirugía General' }] },
          },
          {
            identifier: [{ use: 'official', type: { text: 'PRO' }, system: REFEPS_SYSTEM, value: '49448' }],
            code: { coding: [{ system: 'http://fhir.msal.gov.ar/ValueSet/Profesiones_REFEPS', code: '10003233', display: 'Médico' }] },
            period: { start: '1982-11-02T00:00:00-03:00' },
          },
          {
            identifier: [{ use: 'official', type: { text: 'ESP' }, assigner: { display: '7' } }],
            code: { coding: [{ display: 'Salud Pública' }] },
          },
        ],
      },
    },
  ],
} as unknown as Bundle;

/** Formato v2 de la guía oficial (09/2025): extensiones y system por jurisdicción. */
function v2Practitioner(over: { habilitada?: boolean; end?: string; value?: string } = {}): Practitioner {
  return {
    resourceType: 'Practitioner',
    id: '20149543',
    identifier: [
      { use: 'official', system: REFEPS_SYSTEM, value: '541012497922' },
      { use: 'secondary', system: 'https://www.renaper.org.ar/dni', value: '12497922' },
      { use: 'secondary', system: 'https://www.anses.org.ar/cuil', value: '27124979221' },
    ],
    active: true,
    name: [{ given: ['Tubau'], family: 'Cepeda', text: 'Cepeda, Tubau' }],
    gender: 'female',
    birthDate: '1956-10-18',
    qualification: [
      {
        extension: [
          {
            url: 'http://fhir.msal.gob.ar/StructureDefinition/MatriculaHabilitada',
            valueBoolean: over.habilitada ?? true,
          },
          { url: 'http://fhir.msal.gob.ar/StructureDefinition/jurisdMatricula', valueCoding: { code: '02', display: 'CABA' } },
          {
            url: 'http://fhir.msal.gob.ar/StructureDefinition/especialidadMatricula',
            valueCoding: { code: '5', display: 'Cirugía infantil (Cirugía Pediátrica)' },
          },
          {
            url: 'http://fhir.msal.gob.ar/StructureDefinition/especialidadMatricula',
            valueCoding: { code: '10', display: 'Gastroenterología' },
          },
        ],
        identifier: [{ system: `${REFEPS_SYSTEM}/35-02`, value: over.value ?? '80270' }],
        code: {
          coding: [{ system: 'http://fhir.msal.gob.ar/CodeSystem/profesionesREFEPSCS', code: '35', display: 'Médico' }],
        },
        period: { start: '1990-06-01', ...(over.end ? { end: over.end } : {}) },
        issuer: {
          identifier: { system: 'https://sisa.msal.gov.ar/REFES', value: '10038021750536' },
          display: 'MINISTERIO DE SALUD DE BUENOS AIRES',
        },
      },
    ],
  };
}

describe('Endpoints', () => {
  // El environment de Postman dice que busUrl es el mismo en los dos ambientes.
  // Las colecciones muestran que no: QA es bus-test.
  test('QA y PROD son hosts distintos', () => {
    expect(BUS_URLS.qa).toBe('https://bus-test.msal.gob.ar');
    expect(BUS_URLS.prod).toBe('https://bus.msal.gob.ar');
    expect(BUS_URLS.qa).not.toBe(BUS_URLS.prod);
  });

  test('búsqueda por DNI: lleva identifier con system y género', () => {
    const url = practitionerSearchUrl('prod', { by: 'dni', dni: '31193088', gender: 'female' });
    expect(url).toContain('https://bus.msal.gob.ar/fhir/Practitioner?');
    expect(decodeURIComponent(url)).toContain('identifier=https://www.renaper.org.ar/dni|31193088');
    expect(url).toContain('gender=female');
  });

  test('búsqueda por CUIL: sin guiones', () => {
    const url = practitionerSearchUrl('prod', { by: 'cuil', cuil: '27-12497922-1' });
    expect(decodeURIComponent(url)).toContain('identifier=https://www.anses.org.ar/cuil|27124979221');
  });

  test('búsqueda por código REFEPS', () => {
    const url = practitionerSearchUrl('qa', { by: 'refeps', code: '541038443917' });
    expect(decodeURIComponent(url)).toContain(`identifier=${REFEPS_SYSTEM}|541038443917`);
  });

  test('búsqueda por id interno va en la ruta, no como query', () => {
    expect(practitionerSearchUrl('qa', { by: 'id', id: '20149543' })).toBe(
      'https://bus-test.msal.gob.ar/fhir/Practitioner/20149543'
    );
  });

  test('normalizeCuil deja solo dígitos', () => {
    expect(normalizeCuil('27-12497922-1')).toBe('27124979221');
  });

  test('las consultas van con Bearer y piden FHIR', () => {
    expect(searchHeaders('abc123')).toMatchObject({
      Authorization: 'Bearer abc123',
      Accept: 'application/fhir+json',
    });
  });
});

describe('Autenticación', () => {
  test('el cuerpo del pedido de token es el que espera el Bus', () => {
    const req = buildAuthRequest({ env: 'prod', clientAssertion: 'JWT.FIRMADO.ACA' });
    expect(req.url).toBe('https://bus.msal.gob.ar/bus-auth/v2/auth');
    expect(JSON.parse(req.body)).toStrictEqual({
      grantType: 'client_credentials',
      scope: 'Practitioner/*.read',
      clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      clientAssertion: 'JWT.FIRMADO.ACA',
    });
  });

  // La guía dice "milisegundos" pero su propio JWT de ejemplo trae segundos.
  // Mandar milisegundos daría un token fechado en 1970.
  test('iat y exp van en segundos, con la vigencia del ejemplo oficial', () => {
    const claims = buildClientAssertionClaims({ issuer: 'https://api.medplum.com.ar', nowSeconds: 1757196526 });
    expect(claims.iat).toBe(1757196526);
    expect(claims.exp - claims.iat).toBe(CLIENT_ASSERTION_TTL_SECONDS);
    expect(CLIENT_ASSERTION_TTL_SECONDS).toBe(3600); // el del JWT de la guía
  });

  test('los claims fijos van con los literales de la guía', () => {
    const claims = buildClientAssertionClaims({ issuer: 'https://api.medplum.com.ar', nowSeconds: 1 });
    expect(claims).toMatchObject({ aud: 'aud', sub: 'sub', name: 'name', ident: 'ident', role: 'role' });
    expect(claims.iss).toBe('https://api.medplum.com.ar');
  });

  // La guía dice que el atributo es 'token'; el script de Postman lee
  // 'accessToken'. Si solo se leyera uno, el otro ambiente fallaría en silencio.
  test('acepta el token venga como "token" o como "accessToken"', () => {
    expect(accessTokenFrom({ token: 'A' })).toBe('A');
    expect(accessTokenFrom({ accessToken: 'B' })).toBe('B');
    expect(accessTokenFrom({ token: 'A', accessToken: 'B' })).toBe('A');
  });

  test('sin token devuelve undefined, no una cadena vacía', () => {
    expect(accessTokenFrom({})).toBeUndefined();
    expect(accessTokenFrom({ token: '' })).toBeUndefined();
    expect(accessTokenFrom(null)).toBeUndefined();
  });
});

describe('Lectura del recurso — formato v1 (colección oficial)', () => {
  const practitioners = practitionersFrom(V1_BUNDLE);
  const p = practitioners[0];

  test('extrae el Practitioner del Bundle', () => {
    expect(practitioners).toHaveLength(1);
    expect(p.id).toBe('10003233');
  });

  // Validar contra la primera dejaría afuera la segunda matrícula.
  test('encuentra LAS DOS matrículas, no solo la primera', () => {
    expect(matriculasOf(p).map((m) => m.value)).toStrictEqual(['61177', '49448']);
  });

  test('no confunde las especialidades con matrículas', () => {
    expect(matriculasOf(p).every((m) => m.profession === 'Médico')).toBe(true);
    expect(especialidadesOf(p)).toStrictEqual(['Cirugía General', 'Salud Pública']);
  });

  test('lee el DNI aunque el system venga sin /dni', () => {
    expect(dniOf(p)).toBe('12497922');
    expect(refepsCodeOf(p)).toBe('541012497922');
  });

  test('sin extensión de habilitación, enabled queda undefined (no false)', () => {
    expect(matriculasOf(p)[0].enabled).toBeUndefined();
  });
});

describe('Lectura del recurso — formato v2 (guía 09/2025)', () => {
  const p = v2Practitioner();

  test('reconoce la matrícula por el system, sin type.text', () => {
    const [m] = matriculasOf(p);
    expect(m.value).toBe('80270');
    expect(m.profession).toBe('Médico');
  });

  test('lee jurisdicción, emisor y habilitación de las extensiones', () => {
    const [m] = matriculasOf(p);
    expect(m.jurisdiction).toBe('CABA');
    expect(m.issuer).toBe('MINISTERIO DE SALUD DE BUENOS AIRES');
    expect(m.enabled).toBe(true);
  });

  // En v2 las especialidades cuelgan de la matrícula, no son qualifications.
  test('las especialidades salen de las extensiones de la matrícula', () => {
    expect(especialidadesOf(p)).toStrictEqual(['Cirugía infantil (Cirugía Pediátrica)', 'Gastroenterología']);
  });

  test('la búsqueda por id devuelve el recurso suelto, sin Bundle', () => {
    expect(practitionersFrom(p)).toHaveLength(1);
  });
});

describe('Comparación de matrícula', () => {
  test('compara por dígitos: el prefijo MN/MP es nuestro, no de REFEPS', () => {
    expect(matriculaMatches('MN 61177', '61177')).toBe(true);
    expect(matriculaMatches('mp61177', '61177')).toBe(true);
    expect(matriculaDigits('MN 61.177')).toBe('61177');
  });

  test('números distintos no coinciden', () => {
    expect(matriculaMatches('MN 61178', '61177')).toBe(false);
  });

  test('una matrícula sin dígitos nunca coincide', () => {
    expect(matriculaMatches('MN', '61177')).toBe(false);
    expect(matriculaMatches('', '61177')).toBe(false);
  });
});

describe('verifyMatricula', () => {
  const v1 = practitionersFrom(V1_BUNDLE);

  test('coincide con la primera matrícula: verificado', () => {
    const r = verifyMatricula({ practitioners: v1, declaredMatricula: 'MN 61177', nowIso: AHORA });
    expect(r.verdict).toBe('verificado');
    expect(r.matched?.value).toBe('61177');
    expect(r.message).toContain('Médico');
  });

  test('coincide con la SEGUNDA matrícula: también verificado', () => {
    expect(verifyMatricula({ practitioners: v1, declaredMatricula: 'MN 49448', nowIso: AHORA }).verdict).toBe(
      'verificado'
    );
  });

  test('no coincide: lo dice y lista las que sí figuran', () => {
    const r = verifyMatricula({ practitioners: v1, declaredMatricula: 'MN 99999', nowIso: AHORA });
    expect(r.verdict).toBe('matricula-no-coincide');
    expect(r.message).toContain('61177');
    expect(r.message).toContain('49448');
  });

  test('sin resultados: no-encontrado', () => {
    expect(verifyMatricula({ practitioners: [], declaredMatricula: 'MN 1', nowIso: AHORA }).verdict).toBe(
      'no-encontrado'
    );
  });

  test('profesional inactivo bloquea aunque la matrícula coincida', () => {
    const inactivo = [{ ...v1[0], active: false }];
    expect(verifyMatricula({ practitioners: inactivo, declaredMatricula: 'MN 61177', nowIso: AHORA }).verdict).toBe(
      'profesional-inactivo'
    );
  });

  test('matrícula no habilitada (v2) bloquea', () => {
    const r = verifyMatricula({
      practitioners: [v2Practitioner({ habilitada: false })],
      declaredMatricula: 'MN 80270',
      nowIso: AHORA,
    });
    expect(r.verdict).toBe('matricula-no-habilitada');
  });

  test('matrícula vencida bloquea y dice desde cuándo', () => {
    const r = verifyMatricula({
      practitioners: [v2Practitioner({ end: '2025-01-01' })],
      declaredMatricula: 'MN 80270',
      nowIso: AHORA,
    });
    expect(r.verdict).toBe('matricula-vencida');
    expect(r.message).toContain('2025-01-01');
  });

  test('vencimiento futuro no bloquea', () => {
    expect(
      verifyMatricula({
        practitioners: [v2Practitioner({ end: '2030-01-01' })],
        declaredMatricula: 'MN 80270',
        nowIso: AHORA,
      }).verdict
    ).toBe('verificado');
  });

  test('un profesional sin matrículas registradas no pasa', () => {
    const sinMatriculas = [{ ...v1[0], qualification: [] }];
    const r = verifyMatricula({ practitioners: sinMatriculas, declaredMatricula: 'MN 61177', nowIso: AHORA });
    expect(r.verdict).toBe('matricula-no-coincide');
    expect(r.message).toMatch(/no tiene matrículas registradas/);
  });

  test('el veredicto verificado arrastra profesión y especialidades', () => {
    const r = verifyMatricula({ practitioners: [v2Practitioner()], declaredMatricula: 'MN 80270', nowIso: AHORA });
    expect(r.profession).toBe('Médico');
    expect(r.specialties).toContain('Gastroenterología');
    expect(r.message).toContain('CABA');
  });
});

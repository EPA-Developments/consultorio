import type { Bundle } from '@medplum/fhirtypes';
import { codigoDelBundle, compararCodigo, resumirSalida } from './ckm-bots-doctor';

// "✓ desplegado" no prueba que el servidor esté ejecutando este código: el
// $deploy puede aceptarse y el bot seguir sirviendo otro. Comparar los dos es
// lo único que lo distingue de un bot sano que no tenía nada que hacer.
describe('Código desplegado vs bundle local', () => {
  test('el mismo código coincide, aunque difiera el whitespace del borde', () => {
    const v = compararCodigo('exports.handler = 1;', 'exports.handler = 1;\n');
    expect(v.coincide).toBe(true);
  });

  test('código distinto no coincide y reporta los tamaños', () => {
    const v = compararCodigo('el codigo real, largo', 'otro');
    expect(v.coincide).toBe(false);
    expect(v.bytesLocal).toBe(21);
    expect(v.bytesDesplegado).toBe(4);
  });

  // El caso que importa: un bot creado por admin/projects/{id}/bot nace con el
  // ejemplo del servidor. Si el despliegue real no se aplicó, ese ejemplo corre
  // sin fallar y sin hacer nada.
  test('reconoce el bot de ejemplo del servidor', () => {
    const v = compararCodigo('el codigo real', 'exports.handler = async () => console.log("Hello world");');
    expect(v.esPlantilla).toBe(true);
  });

  test('un código largo que menciona Hello world no es la plantilla', () => {
    const v = compararCodigo('x', 'Hello world' + 'a'.repeat(2100));
    expect(v.esPlantilla).toBe(false);
  });
});

describe('Extracción del código desde el bundle', () => {
  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      { fullUrl: 'urn:uuid:src', resource: { resourceType: 'Binary', contentType: 'text/plain', data: 'Zm9v' } },
      {
        fullUrl: 'urn:uuid:dist',
        resource: { resourceType: 'Binary', contentType: 'application/javascript', data: 'YmFy' },
      },
      {
        resource: {
          resourceType: 'Bot',
          name: 'favaloro-ckm-alerts',
          executableCode: { contentType: 'application/javascript', url: 'urn:uuid:dist' },
        },
      },
    ],
  };

  // El bundle trae DOS Binary por bot (fuente y ejecutable): comparar contra el
  // fuente TypeScript daría siempre "distinto".
  test('toma el ejecutable del bot, no su fuente', () => {
    expect(codigoDelBundle(bundle).get('favaloro-ckm-alerts')).toBe('bar');
  });

  test('un bot que no está en el bundle no aparece', () => {
    expect(codigoDelBundle(bundle).get('favaloro-refeps-verify')).toBeUndefined();
  });
});

// Un $execute que no falla no prueba que el bot haya hecho algo: si el handler
// sale por un early-return, devuelve undefined y el POST igual reporta éxito.
describe('Salida de un $execute', () => {
  test('sin salida, el bot no procesó nada', () => {
    expect(resumirSalida(undefined)).toMatch(/nada/);
    expect(resumirSalida(null)).toMatch(/nada/);
    expect(resumirSalida('')).toMatch(/nada/);
  });

  test('un recurso devuelto se identifica', () => {
    expect(resumirSalida({ resourceType: 'Patient', id: 'p1' })).toBe('Patient/p1');
  });

  test('cualquier otra cosa se muestra recortada', () => {
    expect(resumirSalida({ verdict: 'verificado' })).toBe('{"verdict":"verificado"}');
  });
});

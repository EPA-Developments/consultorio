import { describirErrorDeStorage, errorDeStorage } from './storage-error';

// Pasó en producción: los cinco bots "desplegados" devolvían 1271 bytes
// idénticos que empezaban con <?xml. No era código viejo — era el bucket
// contestando un error, y el diagnóstico lo leyó como si fuera el bot.
describe('Errores del storage disfrazados de contenido', () => {
  const ACCESS_DENIED =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code>' +
    '<Message>Access Denied</Message><RequestId>ABC</RequestId></Error>';

  test('reconoce el XML de error y extrae el código', () => {
    expect(errorDeStorage(ACCESS_DENIED)).toEqual({ code: 'AccessDenied', message: 'Access Denied' });
  });

  test('también sin la declaración xml', () => {
    expect(errorDeStorage('<Error><Code>NoSuchKey</Code></Error>')?.code).toBe('NoSuchKey');
  });

  test('el código de un bot no es un error de storage', () => {
    expect(errorDeStorage('"use strict";\nvar x = 1;')).toBeUndefined();
  });

  // Un bot podría contener la cadena "<Error>" en un mensaje; lo que importa es
  // que el CUERPO empiece siendo XML.
  test('mencionar <Error> adentro no alcanza', () => {
    expect(errorDeStorage('console.log("<Error>");')).toBeUndefined();
  });

  test('describe el error para el log', () => {
    expect(describirErrorDeStorage({ code: 'AccessDenied', message: 'Access Denied' })).toBe(
      'AccessDenied: Access Denied'
    );
    expect(describirErrorDeStorage({})).toMatch(/sin detalle/);
  });
});

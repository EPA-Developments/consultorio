import type { Appointment } from '@medplum/fhirtypes';
import { codigoServicioDeTurno, conteoParaGate, contarSesiones } from './session-count';
import { evaluarTerapia } from './safety';
import { indiceCodigosServicio, SISTEMA_SERVICIO, terapiaPorId } from './therapy-catalog';

/** Participante mínimo: el tipo de Medplum lo exige en todo Appointment. */
const PARTICIPANTE = [{ actor: { reference: 'Patient/p1' }, status: 'accepted' as const }];

const AHORA = new Date('2026-08-07T12:00:00Z');
const AYER = '2026-08-06T10:00:00Z';
const MANANA = '2026-08-08T10:00:00Z';

/** Turno como los escribe recepción: el código de servicio en serviceType. */
function turno(status: Appointment['status'], codigo: string, start = AYER): Appointment {
  return {
    resourceType: 'Appointment',
    status,
    start,
    serviceType: [{ coding: [{ system: SISTEMA_SERVICIO, code: codigo }] }],
    participant: PARTICIPANTE,
  };
}

/** El mismo turno, con el código en la extensión que usa el bot de reserva. */
function turnoConExtension(status: Appointment['status'], codigo: string): Appointment {
  return {
    resourceType: 'Appointment',
    status,
    start: AYER,
    extension: [{ url: 'https://biowellness.ar/fhir/StructureDefinition/itemCodigo', valueString: codigo }],
    participant: PARTICIPANTE,
  };
}

function contar(turnos: Appointment[]): ReturnType<typeof contarSesiones> {
  return contarSesiones(turnos, { ahora: AHORA });
}

describe('Lectura del código de servicio', () => {
  test('lo lee de serviceType', () => {
    expect(codigoServicioDeTurno(turno('fulfilled', 'HBOT_MONO'))).toBe('HBOT_MONO');
  });

  test('lo lee de la extensión cuando no hay serviceType', () => {
    expect(codigoServicioDeTurno(turnoConExtension('fulfilled', 'IHHT'))).toBe('IHHT');
  });

  test('un turno sin código no rompe nada', () => {
    expect(
      codigoServicioDeTurno({ resourceType: 'Appointment', status: 'fulfilled', participant: PARTICIPANTE })
    ).toBeUndefined();
  });

  test('ignora codings de otro sistema', () => {
    const a: Appointment = {
      resourceType: 'Appointment',
      status: 'fulfilled',
      participant: PARTICIPANTE,
      serviceType: [{ coding: [{ system: 'http://snomed.info/sct', code: '183460006' }] }],
    };
    expect(codigoServicioDeTurno(a)).toBeUndefined();
  });
});

describe('Qué turno cuenta como sesión', () => {
  // La distinción central: comprado no es administrado.
  test('un turno confirmado y pago NO cuenta como sesión', () => {
    const c = contar([turno('booked', 'HBOT_MONO'), turno('pending', 'HBOT_MONO')]);
    expect(c.porTerapia.hbot).toBe(0);
  });

  test('un turno completado cuenta', () => {
    expect(contar([turno('fulfilled', 'HBOT_MONO')]).porTerapia.hbot).toBe(1);
  });

  test('cancelado y ausente no cuentan', () => {
    const c = contar([turno('cancelled', 'HBOT_MONO'), turno('noshow', 'HBOT_MONO')]);
    expect(c.porTerapia.hbot).toBe(0);
  });

  // Ante la duda se cuenta de más: el tope pide evaluación, no bloquea.
  test('el paciente llegó y nadie cerró el turno: cuenta y se avisa', () => {
    const c = contar([turno('arrived', 'HBOT_MONO'), turno('checked-in', 'HBOT_MONO')]);
    expect(c.porTerapia.hbot).toBe(2);
    expect(c.sinCerrar).toBe(2);
  });

  test('un turno en curso hoy todavía no ocurrió', () => {
    const c = contar([turno('checked-in', 'HBOT_MONO', MANANA)]);
    expect(c.porTerapia.hbot).toBe(0);
    expect(c.sinCerrar).toBe(0);
  });

  test('un turno completado sin fecha cuenta igual', () => {
    const sinFecha: Appointment = { ...turno('fulfilled', 'HBOT_MONO'), start: undefined };
    expect(contar([sinFecha]).porTerapia.hbot).toBe(1);
  });
});

describe('Atribución por terapia', () => {
  test('las sesiones de una terapia no cuentan para otra', () => {
    const c = contar([turno('fulfilled', 'HBOT_MONO'), turno('fulfilled', 'IHHT'), turno('fulfilled', 'IHHT')]);
    expect(c.porTerapia).toStrictEqual({ hbot: 1, ihht: 2 });
  });

  test('cero es un dato para las terapias que el catálogo sabe contar', () => {
    const c = contar([]);
    expect(c.porTerapia.hbot).toBe(0);
    expect(c.confiable).toBe(true);
  });

  // Las terapias sin códigos declarados no aparecen: sin dato no es cero.
  test('una terapia sin códigos de servicio queda fuera del conteo', () => {
    expect(contar([]).porTerapia['red-light']).toBeUndefined();
  });

  test('un turno que no es de terapia (una consulta) no suma a ninguna', () => {
    const consulta: Appointment = {
      resourceType: 'Appointment',
      status: 'fulfilled',
      start: AYER,
      participant: PARTICIPANTE,
    };
    const c = contar([consulta, turno('fulfilled', 'HBOT_MONO')]);
    expect(c.porTerapia.hbot).toBe(1);
    expect(c.codigosSinMapear).toStrictEqual([]);
  });
});

describe('Un conteo incompleto se declara', () => {
  // El catálogo todavía no tiene todos los códigos de recepción. El riesgo no
  // es no saberlo: es informar un total bajo como si fuera el total.
  test('un código desconocido marca el conteo como no confiable', () => {
    const c = contar([turno('fulfilled', 'HBOT_MONO'), turno('fulfilled', 'HBOT_BIPLAZA')]);
    expect(c.confiable).toBe(false);
    expect(c.codigosSinMapear).toStrictEqual(['HBOT_BIPLAZA']);
  });

  test('el código desconocido se reporta una sola vez', () => {
    const c = contar([turno('fulfilled', 'CRIO'), turno('fulfilled', 'CRIO'), turno('fulfilled', 'MASAJE')]);
    expect(c.codigosSinMapear).toStrictEqual(['CRIO', 'MASAJE']);
  });

  // Un código desconocido en un turno cancelado no ensucia el conteo.
  test('solo los turnos que cuentan pueden dejar códigos sin mapear', () => {
    expect(contar([turno('booked', 'CRIO')]).confiable).toBe(true);
  });

  test('un conteo no confiable no llega al gate', () => {
    const c = contar([turno('fulfilled', 'HBOT_MONO'), turno('fulfilled', 'DESCONOCIDO')]);
    expect(conteoParaGate(c)).toBeUndefined();
  });

  test('un conteo confiable sí llega al gate', () => {
    expect(conteoParaGate(contar([turno('fulfilled', 'HBOT_MONO')]))).toStrictEqual({ hbot: 1, ihht: 0 });
  });
});

describe('El contador cierra el circuito con el gate de seguridad', () => {
  const HBOT = terapiaPorId('hbot')!;

  test('cien turnos completados disparan la evaluación del tope', () => {
    const turnos = Array.from({ length: 100 }, () => turno('fulfilled', 'HBOT_MONO'));
    const conteo = contar(turnos);
    const r = evaluarTerapia(HBOT, {
      condiciones: [],
      sesionesAcumuladas: conteoParaGate(conteo),
      origenConteo: conteo.origenConteo,
    });
    expect(r.resultado).toBe('evaluar');
    expect(r.sesionesAcumuladas).toBe(100);
    expect(r.origenConteo).toBe('administradas');
  });

  // El escenario que hace peligroso contar de menos: si un código sin mapear
  // se tomara como cero, este paciente pasaría como si no tuviera exposición.
  test('con códigos sin mapear el tope no se evalúa, en vez de evaluarse contra un número bajo', () => {
    const turnos = [
      ...Array.from({ length: 100 }, () => turno('fulfilled', 'HBOT_BIPLAZA')),
      turno('fulfilled', 'HBOT_MONO'),
    ];
    const conteo = contar(turnos);
    const r = evaluarTerapia(HBOT, { condiciones: [], sesionesAcumuladas: conteoParaGate(conteo) });
    expect(r.sesionesAcumuladas).toBeUndefined();
    expect(r.limites).toStrictEqual([]);
    expect(conteo.confiable).toBe(false);
  });

  test('turnos reservados a futuro no adelantan el tope', () => {
    const turnos = Array.from({ length: 100 }, () => turno('booked', 'HBOT_MONO', MANANA));
    const conteo = contar(turnos);
    const r = evaluarTerapia(HBOT, { condiciones: [], sesionesAcumuladas: conteoParaGate(conteo) });
    expect(r.resultado).toBe('permitir');
  });
});

describe('Índice de códigos del catálogo', () => {
  test('mapea los códigos declarados a su terapia', () => {
    const idx = indiceCodigosServicio();
    expect(idx.get('HBOT_MONO')).toBe('hbot');
    expect(idx.get('IHHT')).toBe('ihht');
  });

  // Las tres cámaras son un solo HBOT a efectos de exposición acumulada.
  test('varios códigos pueden apuntar a la misma terapia', () => {
    const idx = indiceCodigosServicio([
      { ...terapiaPorId('hbot')!, codigosServicio: ['HBOT_MONO', 'HBOT_BI', 'HBOT_MULTI'] },
    ]);
    expect([...idx.values()].every((v) => v === 'hbot')).toBe(true);
    expect(idx.size).toBe(3);
  });
});

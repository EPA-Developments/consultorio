import type { Condition } from '@medplum/fhirtypes';
import { evaluarCatalogo, evaluarTerapia, ordenarPorRiesgo, ORIGEN_CONTEO_LABELS } from './safety';
import type { DatosPaciente } from './safety';
import { terapiaPorId, todasLasTerapias } from './therapy-catalog';

/** Condition activa con código ICD-10, como las que trae la historia. */
function condicion(code: string, texto: string): Condition {
  return {
    resourceType: 'Condition',
    subject: { reference: 'Patient/p1' },
    clinicalStatus: { coding: [{ code: 'active' }] },
    code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code, display: texto }], text: texto },
  };
}

const SANO: DatosPaciente = { condiciones: [] };

const HBOT = terapiaPorId('hbot')!;
const IHHT = terapiaPorId('ihht')!;
const RECOVERY = terapiaPorId('recovery-pro')!;
const BOTAS = terapiaPorId('botas')!;

describe('Paciente sin antecedentes', () => {
  test('no hay impedimentos, pero recuerda el tamizaje pendiente', () => {
    const r = evaluarTerapia(HBOT, SANO);
    expect(r.resultado).toBe('permitir');
    expect(r.bloqueos).toStrictEqual([]);
    expect(r.tamizajePendiente.length).toBeGreaterThan(0);
    expect(r.mensaje).toMatch(/tamizaje previo/i);
  });

  test('todo el catálogo queda permitido', () => {
    const evs = evaluarCatalogo(todasLasTerapias(), SANO);
    expect(evs.every((e) => e.resultado === 'permitir')).toBe(true);
  });
});

describe('Bloqueos', () => {
  test('neumotórax bloquea HBOT', () => {
    const r = evaluarTerapia(HBOT, { condiciones: [condicion('J93.0', 'Neumotórax espontáneo')] });
    expect(r.resultado).toBe('bloquear');
    expect(r.bloqueos[0].contraindicacion.id).toBe('neumotorax');
    expect(r.bloqueos[0].motivo).toBe('Neumotórax espontáneo');
    expect(r.mensaje).toMatch(/No corresponde/);
  });

  test('hipertensión pulmonar bloquea IHHT', () => {
    const r = evaluarTerapia(IHHT, { condiciones: [condicion('I27.0', 'Hipertensión pulmonar primaria')] });
    expect(r.resultado).toBe('bloquear');
  });

  test('TVP bloquea las Botas', () => {
    const r = evaluarTerapia(BOTAS, { condiciones: [condicion('I80.2', 'Trombosis venosa profunda')] });
    expect(r.resultado).toBe('bloquear');
    expect(r.bloqueos[0].contraindicacion.id).toBe('tvp');
  });

  test('el embarazo bloquea Recovery Pro pero no IHHT', () => {
    const embarazada: DatosPaciente = { condiciones: [condicion('Z34.0', 'Supervisión de embarazo normal')] };
    expect(evaluarTerapia(RECOVERY, embarazada).resultado).toBe('bloquear');
    expect(evaluarTerapia(IHHT, embarazada).resultado).toBe('evaluar');
  });

  test('una condición que no matchea ningún patrón no bloquea nada', () => {
    const r = evaluarTerapia(HBOT, { condiciones: [condicion('M54.5', 'Lumbalgia')] });
    expect(r.resultado).toBe('permitir');
  });
});

describe('Diferir la sesión', () => {
  // El hallazgo que GLP-1 nunca necesitó: la fiebre no descarta al paciente.
  test('la fiebre difiere la sesión y lo dice explícitamente', () => {
    const r = evaluarTerapia(IHHT, { condiciones: [], situacionesDelDia: ['fiebre'] });
    expect(r.resultado).toBe('diferir');
    expect(r.mensaje).toMatch(/sigue siendo candidato/i);
  });

  test('el alcohol difiere Recovery Pro', () => {
    const r = evaluarTerapia(RECOVERY, { condiciones: [], situacionesDelDia: ['alcohol'] });
    expect(r.resultado).toBe('diferir');
    expect(r.diferimientos[0].contraindicacion.id).toBe('alcohol');
  });

  test('una situación del día que la terapia no contempla no difiere nada', () => {
    const r = evaluarTerapia(HBOT, { condiciones: [], situacionesDelDia: ['alcohol'] });
    expect(r.resultado).toBe('permitir');
  });

  test('sin situaciones del día no hay diferimientos', () => {
    expect(evaluarTerapia(IHHT, SANO).diferimientos).toStrictEqual([]);
  });
});

describe('Evaluación previa', () => {
  test('EPOC manda HBOT a evaluación, no a bloqueo', () => {
    const r = evaluarTerapia(HBOT, { condiciones: [condicion('J44.9', 'EPOC')] });
    expect(r.resultado).toBe('evaluar');
    expect(r.bloqueos).toStrictEqual([]);
    expect(r.evaluaciones[0].contraindicacion.id).toBe('epoc-retenedor');
  });

  test('Raynaud manda Recovery Pro a evaluación', () => {
    const r = evaluarTerapia(RECOVERY, { condiciones: [condicion('I73.0', 'Fenómeno de Raynaud')] });
    expect(r.resultado).toBe('evaluar');
  });
});

describe('Precedencia', () => {
  // Un paciente con contraindicación absoluta Y fiebre tiene que ver que la
  // terapia no corresponde, no que "se difiere la sesión de hoy".
  test('bloquear gana sobre diferir', () => {
    const r = evaluarTerapia(IHHT, {
      condiciones: [condicion('I27.0', 'Hipertensión pulmonar')],
      situacionesDelDia: ['fiebre'],
    });
    expect(r.resultado).toBe('bloquear');
    expect(r.diferimientos.length).toBeGreaterThan(0); // se registra igual
  });

  test('diferir gana sobre evaluar', () => {
    const r = evaluarTerapia(HBOT, {
      condiciones: [condicion('J44.9', 'EPOC')],
      situacionesDelDia: ['fiebre'],
    });
    expect(r.resultado).toBe('diferir');
    expect(r.evaluaciones.length).toBeGreaterThan(0);
  });
});

describe('Caso clínico: paciente de 62 con varios antecedentes', () => {
  const paciente: DatosPaciente = {
    condiciones: [
      condicion('I10', 'Hipertensión arterial'),
      condicion('I73.0', 'Fenómeno de Raynaud'),
      condicion('E11.9', 'Diabetes tipo 2'),
    ],
  };

  test('Recovery Pro queda bloqueado por la hipertensión sin control', () => {
    const r = evaluarTerapia(RECOVERY, paciente);
    expect(r.resultado).toBe('bloquear');
    expect(r.bloqueos.map((h) => h.contraindicacion.id)).toContain('arritmia');
  });

  test('HBOT queda libre para el mismo paciente', () => {
    expect(evaluarTerapia(HBOT, paciente).resultado).toBe('permitir');
  });

  test('el orden por riesgo pone lo bloqueado primero y lo libre al final', () => {
    const orden = ordenarPorRiesgo(evaluarCatalogo(todasLasTerapias(), paciente));
    expect(orden[0].resultado).toBe('bloquear');
    expect(orden[orden.length - 1].resultado).toBe('permitir');
  });
});

describe('Topes de exposición acumulada en el circuito', () => {
  // El límite estaba declarado en el catálogo pero el motor no lo evaluaba:
  // existía el artefacto y no estaba en el circuito real.
  test('sin conteo de sesiones no se evalúa ningún tope', () => {
    const r = evaluarTerapia(HBOT, SANO);
    expect(r.limites).toStrictEqual([]);
    expect(r.sesionesAcumuladas).toBeUndefined();
    expect(r.resultado).toBe('permitir');
  });

  test('con pocas sesiones no cambia nada', () => {
    const r = evaluarTerapia(HBOT, { condiciones: [], sesionesAcumuladas: { hbot: 8 } });
    expect(r.limites).toStrictEqual([]);
    expect(r.resultado).toBe('permitir');
  });

  // El riesgo no viene de lo que el paciente tiene, sino de cuántas lleva.
  test('a las 100 sesiones exige evaluación aunque los antecedentes estén limpios', () => {
    const r = evaluarTerapia(HBOT, { condiciones: [], sesionesAcumuladas: { hbot: 100 } });
    expect(r.resultado).toBe('evaluar');
    expect(r.mensaje).toMatch(/100 sesiones acumuladas/);
    expect(r.mensaje).toMatch(/irreversible/i);
  });

  test('a las 20 sesiones se registra el control visual sin frenar la indicación', () => {
    const r = evaluarTerapia(HBOT, { condiciones: [], sesionesAcumuladas: { hbot: 25 } });
    expect(r.limites.map((l) => l.sesionesAcumuladas)).toStrictEqual([20]);
    expect(r.resultado).toBe('permitir'); // 'seguimiento' no gatea
  });

  test('un bloqueo por antecedente gana sobre el tope', () => {
    const r = evaluarTerapia(HBOT, {
      condiciones: [condicion('J93.0', 'Neumotórax')],
      sesionesAcumuladas: { hbot: 120 },
    });
    expect(r.resultado).toBe('bloquear');
    expect(r.limites.length).toBeGreaterThan(0); // se registra igual
  });

  test('el conteo es por terapia: las sesiones de una no cuentan para otra', () => {
    const datos = { condiciones: [], sesionesAcumuladas: { hbot: 120 } };
    expect(evaluarTerapia(HBOT, datos).resultado).toBe('evaluar');
    expect(evaluarTerapia(IHHT, datos).resultado).toBe('permitir');
  });

  // Facturación cuenta lo comprado, no lo administrado. La distinción viaja
  // con el dato para que la pantalla pueda decirlo.
  test('el origen del conteo se conserva en la evaluación', () => {
    const r = evaluarTerapia(HBOT, {
      condiciones: [],
      sesionesAcumuladas: { hbot: 100 },
      origenConteo: 'facturacion',
    });
    expect(r.origenConteo).toBe('facturacion');
    expect(ORIGEN_CONTEO_LABELS.facturacion).toMatch(/no desde el registro clínico/);
  });

  test('dos bloques diarios de 8 semanas disparan el tope', () => {
    const r = evaluarTerapia(HBOT, { condiciones: [], sesionesAcumuladas: { hbot: 8 * 7 * 2 } });
    expect(r.resultado).toBe('evaluar');
  });
});

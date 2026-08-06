import type { HumanName, Practitioner } from '@medplum/fhirtypes';
import { MATRICULA_SYSTEM } from '../ckm/argentina';
import {
  checkMatricula,
  checkPractitionerForEmission,
  EmissionBlockedError,
  matriculaOf,
  normalizeMatricula,
} from './practitioner-validation';

function medico(matricula?: string, nombre: HumanName = { given: ['Alejandro'], family: "D'Alessandro" }): Practitioner {
  return {
    resourceType: 'Practitioner',
    name: [nombre],
    ...(matricula ? { identifier: [{ system: MATRICULA_SYSTEM, value: matricula }] } : {}),
  };
}

describe('normalizeMatricula', () => {
  test('recorta, colapsa espacios y pasa a mayúsculas', () => {
    expect(normalizeMatricula('  mn   12345 ')).toBe('MN 12345');
  });
});

describe('checkMatricula', () => {
  test('acepta el formato nacional y el provincial, sin observaciones', () => {
    for (const valor of ['MN 12345', 'MP 4567', 'mn12345']) {
      const r = checkMatricula(valor);
      expect(r.valid, valor).toBe(true);
      expect(r.warning, valor).toBeUndefined();
    }
    expect(checkMatricula('mn12345').normalized).toBe('MN12345');
  });

  test('sin matrícula no se puede emitir', () => {
    expect(checkMatricula(undefined).valid).toBe(false);
    expect(checkMatricula('   ').valid).toBe(false);
    expect(checkMatricula(undefined).problem).toMatch(/no tiene matrícula/i);
  });

  test('una matrícula sin números no es una matrícula', () => {
    expect(checkMatricula('MN').valid).toBe(false);
    expect(checkMatricula('pendiente').valid).toBe(false);
  });

  // No tenemos la lista de formatos de todas las jurisdicciones, así que un
  // formato desconocido se señala pero no bloquea: rechazarlo dejaría afuera a
  // profesionales con matrícula válida.
  test('un formato distinto avisa pero deja emitir', () => {
    const r = checkMatricula('COL. 8891');
    expect(r.valid).toBe(true);
    expect(r.warning).toMatch(/formato MN\/MP/i);
  });
});

describe('matriculaOf', () => {
  test('lee la matrícula del identifier correcto', () => {
    expect(matriculaOf(medico('MN 12345'))).toBe('MN 12345');
  });

  test('ignora otros identificadores', () => {
    const p: Practitioner = {
      resourceType: 'Practitioner',
      identifier: [{ system: 'https://otro.example/id', value: 'X1' }],
    };
    expect(matriculaOf(p)).toBeUndefined();
    expect(matriculaOf(undefined)).toBeUndefined();
  });
});

describe('checkPractitionerForEmission', () => {
  test('un profesional completo puede emitir', () => {
    const r = checkPractitionerForEmission(medico('MN 12345'));
    expect(r.canEmit).toBe(true);
    expect(r.problems).toStrictEqual([]);
    expect(r.matricula).toBe('MN 12345');
  });

  test('sin matrícula no puede emitir', () => {
    const r = checkPractitionerForEmission(medico());
    expect(r.canEmit).toBe(false);
    expect(r.problems[0]).toMatch(/matrícula/i);
  });

  test('sin profesional identificado tampoco', () => {
    expect(checkPractitionerForEmission(undefined).canEmit).toBe(false);
  });

  test('sin nombre cargado no puede emitir', () => {
    const r = checkPractitionerForEmission(medico('MN 12345', {}));
    expect(r.canEmit).toBe(false);
    expect(r.problems.some((p) => /nombre/i.test(p))).toBe(true);
  });

  test('acepta el nombre en text, sin family ni given', () => {
    const r = checkPractitionerForEmission(medico('MN 12345', { text: 'Dra. Stephanie Dos Santos' }));
    expect(r.canEmit).toBe(true);
  });

  test('el aviso de formato no impide emitir', () => {
    const r = checkPractitionerForEmission(medico('COL. 8891'));
    expect(r.canEmit).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  test('acumula todos los problemas, no solo el primero', () => {
    expect(checkPractitionerForEmission(medico(undefined, {})).problems).toHaveLength(2);
  });
});

describe('EmissionBlockedError', () => {
  // Se distingue de una falla de red para que la pantalla pueda decir qué
  // arreglar en vez de "error al generar la orden".
  test('conserva los problemas y se puede distinguir por tipo', () => {
    const err = new EmissionBlockedError(['El profesional no tiene matrícula cargada.']);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('EmissionBlockedError');
    expect(err.problems).toHaveLength(1);
    expect(err.message).toMatch(/No se puede emitir/);
  });
});

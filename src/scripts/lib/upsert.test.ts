import type { Patient } from '@medplum/fhirtypes';
import { esMultipleMatch, mensajeDuplicados, upsertUnico } from './upsert';

const PACIENTE: Patient = { resourceType: 'Patient', id: 'p1' };

function errorDelServidor(): Error & { outcome: { id: string } } {
  return Object.assign(new Error('Multiple resources found matching condition'), {
    outcome: { id: 'multiple-matches' },
  });
}

describe('Detección del caso de duplicados', () => {
  test('reconoce el outcome del servidor', () => {
    expect(esMultipleMatch(errorDelServidor())).toBe(true);
  });

  test('reconoce el mensaje aunque no venga el outcome', () => {
    expect(esMultipleMatch(new Error('Multiple resources found matching condition'))).toBe(true);
  });

  test('no confunde cualquier error con este', () => {
    expect(esMultipleMatch(new Error('Forbidden'))).toBe(false);
    expect(esMultipleMatch(undefined)).toBe(false);
  });
});

describe('upsert con diagnóstico', () => {
  test('el camino feliz no agrega ninguna consulta', async () => {
    const consultas: unknown[] = [];
    const medplum = {
      upsertResource: async (r: Patient) => r,
      searchResources: async (...args: unknown[]) => {
        consultas.push(args);
        return [];
      },
    } as any;
    await expect(upsertUnico(medplum, PACIENTE, 'identifier=x|1')).resolves.toBe(PACIENTE);
    expect(consultas).toStrictEqual([]);
  });

  // El error crudo del servidor no dice qué recurso ni cuáles duplicados: sin
  // eso hay que salir a buscarlos a mano.
  test('ante duplicados dice cuáles son y qué hacer', async () => {
    const medplum = {
      upsertResource: async () => {
        throw errorDelServidor();
      },
      searchResources: async () => [
        { resourceType: 'Patient', id: 'dup-1' },
        { resourceType: 'Patient', id: 'dup-2' },
      ],
    } as any;
    await expect(upsertUnico(medplum, PACIENTE, 'identifier=x|1')).rejects.toThrow(/Patient\/dup-1/);
    await expect(upsertUnico(medplum, PACIENTE, 'identifier=x|1')).rejects.toThrow(/Patient\/dup-2/);
    await expect(upsertUnico(medplum, PACIENTE, 'identifier=x|1')).rejects.toThrow(/Dejá uno solo/);
  });

  // Si además falla la consulta de diagnóstico, igual hay que explicar el caso.
  test('si no se pueden listar los duplicados, el mensaje sigue siendo útil', async () => {
    const medplum = {
      upsertResource: async () => {
        throw errorDelServidor();
      },
      searchResources: async () => {
        throw new Error('Forbidden');
      },
    } as any;
    await expect(upsertUnico(medplum, PACIENTE, 'identifier=x|1')).rejects.toThrow(/no se pudieron listar/);
  });

  test('cualquier otro error pasa tal cual', async () => {
    const medplum = {
      upsertResource: async () => {
        throw new Error('Forbidden');
      },
    } as any;
    await expect(upsertUnico(medplum, PACIENTE, 'identifier=x|1')).rejects.toThrow('Forbidden');
  });
});

describe('Mensaje', () => {
  test('nombra el tipo, la query y cómo mirarlo en el servidor', () => {
    const m = mensajeDuplicados('Condition', 'identifier=sys|ckm-prevent-ref-dm', ['a', 'b']);
    expect(m).toContain('Condition/a');
    expect(m).toContain('GET /fhir/R4/Condition?identifier=sys|ckm-prevent-ref-dm');
  });
});

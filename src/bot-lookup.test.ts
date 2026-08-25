import type { Bot } from '@medplum/fhirtypes';
import { elegirBotPropio } from './bot-lookup';

const FAVALORO = '78ead38c-0f59-4576-b196-71685537588c';
const BIOWELLNESS = '7f068d7d-4633-46e9-9eff-d52bc03625b9';

function bot(id: string, name: string, project?: string): Bot {
  return { resourceType: 'Bot', id, name, ...(project ? { meta: { project } as Bot['meta'] } : {}) };
}

describe('elegirBotPropio', () => {
  test('el bot propio gana aunque el ajeno venga primero', () => {
    const candidatos = [
      bot('ajeno', 'favaloro-ckm-alerts', BIOWELLNESS),
      bot('propio', 'favaloro-ckm-alerts', FAVALORO),
    ];
    expect(elegirBotPropio(candidatos, 'favaloro-ckm-alerts', FAVALORO, 'estricto')?.id).toBe('propio');
    expect(elegirBotPropio(candidatos, 'favaloro-ckm-alerts', FAVALORO, 'tolerante')?.id).toBe('propio');
  });

  test('si el único candidato es de otro proyecto, no es nuestro bot', () => {
    const candidatos = [bot('ajeno', 'favaloro-ckm-alerts', BIOWELLNESS)];
    expect(elegirBotPropio(candidatos, 'favaloro-ckm-alerts', FAVALORO, 'estricto')).toBeUndefined();
    expect(elegirBotPropio(candidatos, 'favaloro-ckm-alerts', FAVALORO, 'tolerante')).toBeUndefined();
  });

  test('ignora las coincidencias parciales de nombre', () => {
    const candidatos = [bot('otro', 'favaloro-ckm-alerts-viejo', FAVALORO)];
    expect(elegirBotPropio(candidatos, 'favaloro-ckm-alerts', FAVALORO, 'tolerante')).toBeUndefined();
  });

  // La diferencia entre los dos modos, que es toda la razón de que existan.
  describe('cuando no se sabe de qué proyecto es el candidato', () => {
    const opaco = [bot('opaco', 'favaloro-refeps-verify')];

    test('el deploy aborta antes que arriesgarse a pisar el bot de otro', () => {
      expect(() => elegirBotPropio(opaco, 'favaloro-refeps-verify', FAVALORO, 'estricto')).toThrow(
        /no devuelve meta.project/
      );
    });

    // El navegador no recibe meta.project salvo en extended mode: exigirlo
    // dejaría al panel sin encontrar NUNCA su propio bot. Acá la defensa es el
    // nombre único, no el proyecto.
    test('el FrontEnd lo acepta', () => {
      expect(elegirBotPropio(opaco, 'favaloro-refeps-verify', FAVALORO, 'tolerante')?.id).toBe('opaco');
    });

    test('pero un propio le gana igual', () => {
      const candidatos = [...opaco, bot('propio', 'favaloro-refeps-verify', FAVALORO)];
      expect(elegirBotPropio(candidatos, 'favaloro-refeps-verify', FAVALORO, 'tolerante')?.id).toBe('propio');
    });
  });

  test('sin candidatos no hay bot', () => {
    expect(elegirBotPropio([], 'favaloro-ckm-recalculate', FAVALORO, 'estricto')).toBeUndefined();
  });
});

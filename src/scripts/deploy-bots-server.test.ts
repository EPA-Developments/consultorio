import type { Bot } from '@medplum/fhirtypes';
import { botDelProyecto } from './deploy-bots-server';

const FAVALORO = '78ead38c-0f59-4576-b196-71685537588c';
const BIOWELLNESS = '7f068d7d-4633-46e9-9eff-d52bc03625b9';

function bot(id: string, name: string, project?: string): Bot {
  return { resourceType: 'Bot', id, name, ...(project ? { meta: { project } as Bot['meta'] } : {}) };
}

function fakeMedplum(resultados: Bot[]): { medplum: any; consultas: unknown[] } {
  const consultas: unknown[] = [];
  return {
    consultas,
    medplum: {
      searchResources: async (_tipo: string, query: unknown) => {
        consultas.push(query);
        return resultados;
      },
    },
  };
}

// Esto no es teórico. Pasó: con Favaloro → Super Admin → Biowellness encadenados
// por Project.link, el deploy lanzado contra Favaloro resolvió cuatro de cinco
// bots a los de OTROS proyectos y les pisó el código ejecutable, reportando
// "Bot existente" con ids ajenos y sin un solo error.
describe('Resolución del bot dentro del proyecto', () => {
  test('elige el bot propio aunque el de otro proyecto aparezca primero', async () => {
    const ctx = fakeMedplum([bot('ajeno', 'ckm-recalculate', BIOWELLNESS), bot('propio', 'ckm-recalculate', FAVALORO)]);
    const encontrado = await botDelProyecto(ctx.medplum, 'ckm-recalculate', FAVALORO);
    expect(encontrado?.id).toBe('propio');
  });

  // El caso que rompió: el nombre existe, pero en el proyecto del vecino. Un bot
  // con el nombre correcto en el proyecto equivocado no es el bot.
  test('si todos los candidatos son de otro proyecto, corresponde crear el propio', async () => {
    const ctx = fakeMedplum([bot('ajeno', 'ckm-alerts', BIOWELLNESS)]);
    await expect(botDelProyecto(ctx.medplum, 'ckm-alerts', FAVALORO)).resolves.toBeUndefined();
  });

  test('sin candidatos, hay que crearlo', async () => {
    const ctx = fakeMedplum([]);
    await expect(botDelProyecto(ctx.medplum, 'ckm-alerts', FAVALORO)).resolves.toBeUndefined();
  });

  // Ante la duda no se despliega: pisar el proyecto de otro es mucho peor que
  // no desplegar.
  test('si no se puede saber de qué proyecto es, aborta en vez de adivinar', async () => {
    const ctx = fakeMedplum([bot('opaco', 'refeps-verify')]);
    await expect(botDelProyecto(ctx.medplum, 'refeps-verify', FAVALORO)).rejects.toThrow(/no devuelve meta.project/);
  });

  test('un bot propio manda aunque haya otro opaco en la lista', async () => {
    const ctx = fakeMedplum([bot('opaco', 'sdoh-response'), bot('propio', 'sdoh-response', FAVALORO)]);
    expect((await botDelProyecto(ctx.medplum, 'sdoh-response', FAVALORO))?.id).toBe('propio');
  });

  // El servidor puede devolver coincidencias parciales por nombre.
  test('ignora los nombres que no son exactos', async () => {
    const ctx = fakeMedplum([bot('otro', 'ckm-alerts-viejo', FAVALORO)]);
    await expect(botDelProyecto(ctx.medplum, 'ckm-alerts', FAVALORO)).resolves.toBeUndefined();
  });
});

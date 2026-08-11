// Marcas comerciales del DNM para el buscador de medicamentos.
//
// LA MARCA BUSCA, LA DCI PRESCRIBE (Ley 25.649): este catálogo existe para
// que el médico que piensa "Crestor" llegue a rosuvastatina — nunca para que
// la marca sea el medicamento de la receta. La marca elegida queda como
// sugerencia sustituible.
//
// Los datos salen de npm run snomed-marcas (FSN de fármacos de uso clínico
// comerciales de la Extensión Argentina / DNM, licencia MLDS). Los kits
// "multiempaque" (ej. ARTOMEY DUO) aparecen una vez por componente: buscar el
// kit muestra sus DCIs y se prescriben todos — que es lo que manda la ley.
import marcasJson from '../../data/recetas/marcas.json';

export interface MarcaComercial {
  marca: string;
  dci: string;
  presentacion: string;
  conceptId: string;
}

interface CatalogoMarcas {
  version: string;
  marcas: MarcaComercial[];
}

const CATALOGO = marcasJson as CatalogoMarcas;

export function marcasDelCatalogo(): MarcaComercial[] {
  return CATALOGO.marcas;
}

/** Una opción del buscador: la etiqueta muestra el par marca → genérico. */
export interface OpcionMarca {
  etiqueta: string;
  marca: string;
  dci: string;
}

/**
 * Opciones únicas (una por par marca+DCI, sin repetir presentaciones),
 * ordenadas por etiqueta. Un kit multiempaque produce una opción por
 * componente.
 */
export function opcionesDeMarca(): OpcionMarca[] {
  const vistas = new Map<string, OpcionMarca>();
  for (const m of CATALOGO.marcas) {
    const etiqueta = `${m.marca} — ${m.dci}`;
    if (!vistas.has(etiqueta)) {
      vistas.set(etiqueta, { etiqueta, marca: m.marca, dci: m.dci });
    }
  }
  return [...vistas.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
}

// Vademécum DNM servido por el servidor (Fase 2 de docs/VADEMECUM-SNOMED.md).
//
// El CodeSystem con los ~17.000 conceptos "en estado comercializado" vive en
// Medplum (cargado con npm run snomed-vademecum); el buscador consulta
// ValueSet/$expand con filtro. Este módulo es la parte PURA del lado del
// cliente: la URL del ValueSet y los parsers que convierten un display del
// DNM en un ítem del formulario de recetas.
//
// La regla de siempre: la marca BUSCA, la DCI PRESCRIBE (Ley 25.649). Elegir
// una marca del vademécum llena la DCI y deja la marca como sugerencia
// sustituible; solo los GENÉRICOS llevan su conceptId como coding (codificar
// la receta con el concepto de la marca sería prescribir la marca).

export const VADEMECUM_VALUESET_URL = 'https://bio.medplum.com.ar/fhir/ValueSet/vademecum-dnm';

/**
 * Índice de búsqueda de diagnósticos (refset SUMAR de la Edición Argentina):
 * CodeSystem propio que espeja los conceptos SNOMED para no mezclar dominios
 * en el buscador de medicamentos. El coding que viaja en la receta es
 * http://snomed.info/sct — el índice solo sirve al autocomplete.
 */
export const DIAGNOSTICOS_SYSTEM = 'https://bio.medplum.com.ar/fhir/CodeSystem/diagnosticos-snomed-ar';
export const DIAGNOSTICOS_VALUESET_URL = 'https://bio.medplum.com.ar/fhir/ValueSet/diagnosticos-snomed-ar';

export interface OpcionVademecum {
  code: string;
  display: string;
}

/** Lo que un resultado del vademécum aporta al ítem del formulario. */
export interface ItemDesdeVademecum {
  dci: string;
  presentacion?: string;
  marcaSugerida?: string;
  snomedId?: string;
}

/** "MARCA [COMPOSICION] FORMA" → sus partes, o undefined si no es una marca. */
export function parseDisplayMarca(display: string): { marca: string; composicion: string; forma: string } | undefined {
  const m = display.match(/^(.*?)\s*\[(.*?)\]\s*(.*)$/);
  if (!m || !m[1].trim() || !m[2].trim()) {
    return undefined;
  }
  return { marca: m[1].trim(), composicion: m[2].trim(), forma: m[3].trim() };
}

/**
 * Convierte un resultado del vademécum en el ítem del formulario.
 *
 * - Marca ("CRESTOR [ROSUVASTATINA 10 MG] COMPRIMIDO RECUBIERTO"): la DCI es
 *   el principio activo de la composición, la dosis viaja a la presentación
 *   junto con la forma, y la marca queda como sugerida. SIN snomedId.
 * - Genérico ("producto que contiene exactamente clorhidrato de metformina
 *   1 gramo por cada comprimido oral…"): la DCI es el principio con su dosis,
 *   la presentación es la forma, y el conceptId viaja como coding.
 * - Cualquier otra forma de display: texto a la DCI, sin inventar nada.
 */
export function itemDesdeVademecum(opcion: OpcionVademecum): ItemDesdeVademecum {
  const marca = parseDisplayMarca(opcion.display);
  if (marca) {
    const idx = marca.composicion.search(/\d/);
    const principio = (idx > 0 ? marca.composicion.slice(0, idx) : marca.composicion).trim().toLowerCase();
    const dosis = idx > 0 ? marca.composicion.slice(idx).trim().toLowerCase() : '';
    return {
      dci: principio,
      presentacion: [marca.forma.toLowerCase(), dosis].filter(Boolean).join(' ').trim() || undefined,
      marcaSugerida: marca.marca,
    };
  }

  const generico = display_generico(opcion.display);
  if (generico) {
    return { dci: generico.dci, presentacion: generico.presentacion, snomedId: opcion.code };
  }

  return { dci: opcion.display };
}

function display_generico(display: string): { dci: string; presentacion?: string } | undefined {
  const m = display.match(/^producto que contiene (?:exactamente )?(.+)$/i);
  if (!m) {
    return undefined;
  }
  const [composicion, ...resto] = m[1].split(/ por cada /i);
  return {
    dci: composicion.trim().toLowerCase(),
    presentacion: resto.length > 0 ? resto.join(' por cada ').trim().toLowerCase() : undefined,
  };
}

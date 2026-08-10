// Catálogo de medicamentos del formulario de recetas.
//
// Es una LISTA DE CONVENIENCIA, no un vademécum: DCI y presentaciones
// habituales de la práctica, para tipear menos y equivocarse menos. No trae
// posologías a propósito — la posología la escribe el profesional en cada
// receta, porque es una decisión clínica por paciente, no un dato de catálogo.
//
// La receta libre (DCI tipeada a mano) siempre está disponible: el catálogo
// acota el tipeo, nunca lo que se puede prescribir.
import catalogoJson from '../../data/recetas/medicamentos.json';

export interface MedicamentoCatalogo {
  dci: string;
  presentaciones: string[];
}

interface CatalogoRecetas {
  version: string;
  estado: 'borrador' | 'validado';
  medicamentos: MedicamentoCatalogo[];
}

const CATALOGO = catalogoJson as CatalogoRecetas;

export function medicamentosDelCatalogo(): MedicamentoCatalogo[] {
  return CATALOGO.medicamentos;
}

export function estadoCatalogo(): 'borrador' | 'validado' {
  return CATALOGO.estado;
}

export function presentacionesDe(dci: string): string[] {
  return CATALOGO.medicamentos.find((m) => m.dci === dci)?.presentaciones ?? [];
}

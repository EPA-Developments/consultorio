// Ensambla el protocolo completo de un tratamiento con GLP-1: qué dosis, en
// qué orden, qué ajustar de la medicación que ya toma, qué vigilar y cuándo
// controlar.
//
// Es soporte a la decisión, no una indicación: arma el esquema de ficha técnica
// y lo ajusta al perfil del paciente para que el médico lo revise.
import type { Flag, GLP1Inputs } from './eligibility';
import { blockers } from './eligibility';
import type { MonitoringVisit, ResponseReview } from './monitoring';
import { monitoringPlan, responseReview } from './monitoring';
import type { Indication, TitrationSchedule } from './titration';
import { concomitantAdjustments, indicationFor, safetyWatch, titrationFor } from './titration';

export interface GLP1Protocol {
  molecule: string;
  indication: Indication;
  titration: TitrationSchedule;
  /** Cambios en la medicación que ya recibe. */
  adjustments: Flag[];
  /** Qué vigilar durante el tratamiento. */
  safety: Flag[];
  monitoring: MonitoringVisit[];
  response: ResponseReview;
}

/**
 * Arma el protocolo para una molécula. Devuelve undefined si esa molécula no
 * tiene esquema para la indicación que corresponde al paciente (por ejemplo,
 * dulaglutida no tiene esquema de control de peso), o si el paciente tiene una
 * contraindicación absoluta: en ese caso no hay protocolo que armar.
 */
export function buildProtocol(i: GLP1Inputs, molecule: string): GLP1Protocol | undefined {
  if (blockers(i).length > 0) {
    return undefined;
  }
  const indication = indicationFor(i);
  const titration = titrationFor(molecule, indication);
  if (!titration) {
    return undefined;
  }
  return {
    molecule,
    indication,
    titration,
    adjustments: concomitantAdjustments(i),
    safety: safetyWatch(i, indication),
    monitoring: monitoringPlan(i, titration),
    response: responseReview(titration),
  };
}

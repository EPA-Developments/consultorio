// Clases y tipos de encuentro que usa la práctica, en castellano.
//
// POR QUÉ ESTÁN ACÁ Y NO EN UN ValueSet DEL SERVIDOR
//
// El formulario apuntaba a `https://example.com/encounter-types`, un ValueSet
// del template de Medplum que vive en `data/core/encounter-types.json` y que
// solo llega al servidor si alguien corre la pantalla `/upload/core`. Nadie la
// corrió, así que el desplegable tiraba "ValueSet not found" y el campo quedaba
// vacío. Un formulario que depende de un paso de seed que no está documentado
// en ningún flujo se rompe así.
//
// Además el ValueSet del template trae 15 opciones en inglés —obstetricia,
// odontología, guardia, internación de largo plazo— que no son de esta
// práctica. Se declaran acá las que sí, ya traducidas: el desplegable funciona
// sin depender del servidor y ofrece lo que el médico realmente elige.
//
// Los códigos son los mismos de `data/core/encounter-types.json` (SNOMED) y los
// de HL7 v3-ActCode para la clase; no se inventó ninguno.
import type { QuestionnaireItemAnswerOption } from '@medplum/fhirtypes';

const SNOMED = 'http://snomed.info/sct';
const ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';

/**
 * Clase del encuentro: dónde ocurre. Del ValueSet v3-ActEncounterCode se dejan
 * las cuatro que aplican; el resto (internación, obstetricia, campo) no existen
 * en la práctica.
 */
export const CLASES_ENCUENTRO: QuestionnaireItemAnswerOption[] = [
  { valueCoding: { system: ACT_CODE, code: 'AMB', display: 'Ambulatorio (consultorio)' } },
  { valueCoding: { system: ACT_CODE, code: 'VR', display: 'Virtual (videoconsulta)' } },
  { valueCoding: { system: ACT_CODE, code: 'HH', display: 'Domicilio' } },
  { valueCoding: { system: ACT_CODE, code: 'EMER', display: 'Urgencia' } },
];

/** Tipo del encuentro: qué se hace. */
export const TIPOS_ENCUENTRO: QuestionnaireItemAnswerOption[] = [
  { valueCoding: { system: SNOMED, code: '11429006', display: 'Consulta' } },
  { valueCoding: { system: SNOMED, code: '390906007', display: 'Control de seguimiento' } },
  { valueCoding: { system: SNOMED, code: '185317003', display: 'Teleconsulta' } },
  { valueCoding: { system: SNOMED, code: '371883000', display: 'Procedimiento ambulatorio' } },
  { valueCoding: { system: SNOMED, code: '110466009', display: 'Evaluación previa a un procedimiento' } },
  { valueCoding: { system: SNOMED, code: '439708006', display: 'Visita domiciliaria' } },
];

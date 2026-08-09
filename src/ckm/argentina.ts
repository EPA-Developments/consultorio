// Localización Argentina del recurso Patient: sistemas de identificador (DNI,
// CUIL), género autopercibido (Ley 26.743) y provincias. Módulo puro (sin UI)
// compartido por el script de carga (localize-argentina) y el panel "Datos
// Argentina" del FrontEnd, para que ambos usen exactamente las mismas URIs.
//
// NOTA de interoperabilidad: estas URIs son una convención del proyecto. Si se
// va a intercambiar datos con otras instituciones argentinas, conviene alinear
// los `system` con los que publique HL7 Argentina en su IG de base.
import type { CodeableConcept, Patient } from '@medplum/fhirtypes';

/** `system` canónico del DNI (Documento Nacional de Identidad). */
export const DNI_SYSTEM = 'https://www.argentina.gob.ar/dni';
/** `system` canónico del CUIL/CUIT (clave laboral/tributaria). */
export const CUIL_SYSTEM = 'https://www.afip.gob.ar/cuit';
/** `system` de la matrícula del profesional (en Practitioner). */
export const MATRICULA_SYSTEM = 'https://www.argentina.gob.ar/matricula-nacional';

/**
 * Sistemas ACEPTADOS al leer, además del canónico. Mismo patrón que
 * LOINC_SYNONYMS: la escritura usa el canónico, la lectura tolera los
 * sinónimos que aparecen en los datos reales.
 *
 * Existen porque los Practitioner cargados a mano en el admin usan sistemas
 * razonables que no son los nuestros: la matrícula bajo el dominio de REFEPS
 * (que es el registro donde vive) y el CUIT bajo el de AFIP (que es quien lo
 * emite). Rechazarlos por el `system` deja al profesional como "sin matrícula"
 * cuando la matrícula está cargada y es correcta.
 */
export const MATRICULA_SYSTEMS = [
  MATRICULA_SYSTEM,
  'http://refeps.msal.gob.ar',
  'https://refeps.msal.gob.ar',
  'https://federador.msal.gob.ar/refeps',
];

export const CUIL_SYSTEMS = [CUIL_SYSTEM, 'http://afip.gob.ar', 'https://afip.gob.ar', 'http://www.afip.gob.ar'];

/** Primer identifier cuyo system esté en la lista (en orden de la lista). */
export function identifierIn(
  identifiers: { system?: string; value?: string }[] | undefined,
  systems: string[]
): string | undefined {
  for (const system of systems) {
    const found = identifiers?.find((i) => i.system === system && i.value);
    if (found) {
      return found.value;
    }
  }
  return undefined;
}

/** URL canónica del perfil Patient AR (StructureDefinition). */
export const PATIENT_AR_PROFILE_URL = 'https://seguimiento.medplum.com.ar/fhir/StructureDefinition/PatientArgentina';

/** Extensión FHIR estándar de identidad de género (backport de R5). */
export const GENDER_IDENTITY_EXTENSION = 'http://hl7.org/fhir/StructureDefinition/patient-genderIdentity';

/** CodeSystem local de género autopercibido (incluye "X" no binario, Ley 26.743). */
export const GENDER_IDENTITY_SYSTEM = 'https://seguimiento.medplum.com.ar/fhir/CodeSystem/genero-autopercibido';

export interface CodedOption {
  code: string;
  display: string;
}

/** Opciones de género autopercibido según el marco legal argentino. */
export const GENDER_IDENTITY_OPTIONS: CodedOption[] = [
  { code: 'masculino', display: 'Masculino' },
  { code: 'femenino', display: 'Femenino' },
  { code: 'no-binario', display: 'No binario (X)' },
  { code: 'otro', display: 'Otro' },
  { code: 'prefiere-no-decir', display: 'Prefiere no decir' },
];

/** Las 23 provincias argentinas + CABA, para Patient.address.state. */
export const AR_PROVINCES: string[] = [
  'Ciudad Autónoma de Buenos Aires',
  'Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
];

/** Lee el valor de un identificador del paciente por `system`. */
export function getIdentifierValue(patient: Patient | undefined, system: string): string | undefined {
  return patient?.identifier?.find((id) => id.system === system)?.value;
}

/**
 * Devuelve un nuevo array de identificadores con el valor del `system` dado
 * actualizado (o eliminado si value está vacío), preservando los demás.
 */
export function setIdentifierValue(
  patient: Patient,
  system: string,
  value: string,
  typeText?: string
): Patient['identifier'] {
  const others = (patient.identifier ?? []).filter((id) => id.system !== system);
  const trimmed = value.trim();
  if (!trimmed) {
    return others;
  }
  return [...others, { system, value: trimmed, ...(typeText ? { type: { text: typeText } } : {}) }];
}

/** Lee el código de género autopercibido desde la extensión del paciente. */
export function getGenderIdentity(patient: Patient | undefined): string | undefined {
  const ext = patient?.extension?.find((e) => e.url === GENDER_IDENTITY_EXTENSION);
  return ext?.valueCodeableConcept?.coding?.find((c) => c.system === GENDER_IDENTITY_SYSTEM)?.code;
}

/** Construye el CodeableConcept de género autopercibido a partir de un código. */
export function genderIdentityConcept(code: string): CodeableConcept | undefined {
  const option = GENDER_IDENTITY_OPTIONS.find((o) => o.code === code);
  if (!option) {
    return undefined;
  }
  return {
    coding: [{ system: GENDER_IDENTITY_SYSTEM, code: option.code, display: option.display }],
    text: option.display,
  };
}

/**
 * Devuelve un nuevo array de extensiones con la identidad de género
 * actualizada (o eliminada si code está vacío), preservando las demás.
 */
export function setGenderIdentity(patient: Patient, code: string): Patient['extension'] {
  const others = (patient.extension ?? []).filter((e) => e.url !== GENDER_IDENTITY_EXTENSION);
  const concept = code ? genderIdentityConcept(code) : undefined;
  if (!concept) {
    return others.length > 0 ? others : undefined;
  }
  return [...others, { url: GENDER_IDENTITY_EXTENSION, valueCodeableConcept: concept }];
}

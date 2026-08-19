// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
//
// Marca del producto: UNA sola fuente de verdad para todo lo que el humano ve.
//
// Regla que no se rompe: acá vive el NOMBRE, no los IDENTIFICADORES. Los
// canonical URL de FHIR (`https://bio.medplum.com.ar/fhir/...`,
// `https://biowellness.ar/fhir/...`) identifican recursos que ya existen en
// producción — recetas selladas, órdenes emitidas, los 50 biomarcadores — y se
// quedan como están aunque la marca cambie. Un canonical es un identificador,
// no un cartel. Ver `docs/MARCA-Y-PLATAFORMA.md`.
//
// Los valores se pueden sobreescribir por entorno (prefijo MEDPLUM_, el único
// que Vite expone junto con GOOGLE_; ver vite.config.ts) para que un segundo
// deploy del mismo repo pueda cambiar el membrete sin tocar el código.

export interface BrandConfig {
  /** Nombre completo de la plataforma. */
  name: string;
  /** Módulo dentro de la plataforma (lo que corre en este deploy). */
  appName: string;
  /** Wordmark de respaldo: mitad acentuada. */
  wordmarkLead: string;
  /** Wordmark de respaldo: mitad neutra. */
  wordmarkTail: string;
  /** Bajada de la landing y del login. */
  tagline: string;
  /** Membrete de recetas y órdenes de laboratorio impresas. */
  clinicName: string;
  /** Segunda línea del membrete (especialidad · localidad). */
  clinicSubtitle: string;
}

const DEFAULTS: BrandConfig = {
  name: 'Favaloro | Medplum Argentina',
  appName: 'Consultorio',
  wordmarkLead: 'Favaloro',
  wordmarkTail: 'Medplum Argentina',
  tagline: 'Historia clínica, prescripción y laboratorio sobre FHIR',
  clinicName: 'Favaloro | Medplum Argentina',
  clinicSubtitle: 'Consultorio · Prescripción electrónica y laboratorio',
};

const env = import.meta.env;

export const BRAND: BrandConfig = {
  name: env?.MEDPLUM_BRAND_NAME || DEFAULTS.name,
  appName: env?.MEDPLUM_BRAND_APP_NAME || DEFAULTS.appName,
  wordmarkLead: env?.MEDPLUM_BRAND_WORDMARK_LEAD || DEFAULTS.wordmarkLead,
  wordmarkTail: env?.MEDPLUM_BRAND_WORDMARK_TAIL || DEFAULTS.wordmarkTail,
  tagline: env?.MEDPLUM_BRAND_TAGLINE || DEFAULTS.tagline,
  clinicName: env?.MEDPLUM_BRAND_CLINIC_NAME || DEFAULTS.clinicName,
  clinicSubtitle: env?.MEDPLUM_BRAND_CLINIC_SUBTITLE || DEFAULTS.clinicSubtitle,
};

/** Título de ventana y de documentos: "Favaloro | Medplum Argentina · Consultorio". */
export function brandTitle(): string {
  return `${BRAND.name} · ${BRAND.appName}`;
}

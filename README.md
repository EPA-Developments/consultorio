<h1 align="center">Consultorio · Favaloro | Medplum Argentina</h1>
<p align="center">El espacio de trabajo clínico del profesional, sobre FHIR R4 y Medplum.</p>
<p align="center">
  <a href="./LICENSE.txt"><img src="https://img.shields.io/badge/license-Apache-blue.svg" /></a>
</p>

**Producción:** https://consultorio.medplum.com.ar · **BackEnd:** https://api.medplum.com.ar

## Qué es

**Consultorio** es el módulo de trabajo diario de la plataforma **Favaloro |
Medplum Argentina**. Un profesional entra y tiene todo en un solo lugar:

| Capacidad | Qué resuelve |
| --- | --- |
| **Recibir pacientes** | Historia clínica, evoluciones, alta y búsqueda por nombre o DNI. |
| **Evaluar CKM** | Estadío Cardio-Reno-Metabólico (0–4) según la guía AHA/ACC/ADA/ASN, riesgo con las ecuaciones **PREVENT** (ASCVD 10a, IC 10a, ECV total 30a) y hGraph. |
| **Plan Bienestar 100 Días** | Planes de cuidado (`CarePlan`) generados y revisados por el profesional. |
| **Solicitar laboratorio** | Órdenes por preset o marcador, con validación de matrícula y REFEPS. |
| **Prescribir** | Recetas por nombre genérico (DCI, Ley 25.649), codificadas con SNOMED CT Edición Argentina. |

Los dos últimos —**laboratorio y prescripción**— son el foco de trabajo actual.

## Arquitectura, en una pantalla

- **Frontend**: React 19 + Mantine 8 + TypeScript, build con Vite. Este repo.
- **Backend**: Medplum self-hosted en `api.medplum.com.ar` (FHIR R4). No se usa
  el servidor hosted de Medplum.
- **Bots**: lógica serverless de Medplum (`src/bots`) que recalcula riesgo,
  genera alertas y verifica matrículas contra REFEPS.
- **Terminología**: SNOMED CT (Edición Argentina) y el vademécum DNM viven en un
  **proyecto de terminología propio** (`umls`) que los proyectos clínicos
  consumen por link. Ver `docs/MARCA-Y-PLATAFORMA.md` y `docs/VADEMECUM-SNOMED.md`.

## Marca e identificadores — la regla que no se rompe

El producto se llama **Favaloro | Medplum Argentina**, y ese nombre vive en un
solo archivo: `src/brand.ts`. Todo lo que el humano lee sale de ahí.

Los **canonical URL de FHIR** (`https://bio.medplum.com.ar/fhir/...`,
`https://biowellness.ar/fhir/...`) **no** son marca: son identificadores de
datos que ya existen en producción —recetas selladas, órdenes emitidas,
biomarcadores— y se quedan como están. Renombrarlos rompería la trazabilidad de
documentos legalmente emitidos. Detalle y fundamento en
**`docs/MARCA-Y-PLATAFORMA.md`**.

## Documentación

| Documento | De qué trata |
| --- | --- |
| `docs/MARCA-Y-PLATAFORMA.md` | Marca, identificadores congelados, proyecto de terminología, despliegue. |
| `docs/PROCESO.md` | Todo lo construido, fase por fase. |
| `docs/PRESCRIPCIONES-UX.md` | Requerimientos y referencias del módulo de recetas. |
| `docs/VADEMECUM-SNOMED.md` | Cómo se codifica con SNOMED CT Argentina. |
| `docs/RENAPDIS-CHECKLIST-TECNICO.md` | Requisito por requisito del Decreto 98/23. |
| `docs/RECETARIO-FASE2-LEGAL.md` | Informe para asesoramiento legal. |
| `docs/SEGURIDAD.md` | Datos personales, IA, AccessPolicies, cabeceras HTTP. |
| `docs/PORTAL-INTEGRATION.md` | Contrato con el portal del paciente. |

## Organización del código

```
src/
  brand.ts        marca (única fuente de verdad de los nombres visibles)
  home/           tablero de trabajo del profesional
  ckm/            estadío CKM, PREVENT, biomarcadores, planes de cuidado
  recetas/        prescripción: catálogo, vademécum, emisión, impresión
  laborders/      órdenes de laboratorio: catálogo, REFEPS, emisión, impresión
  encounters/     evoluciones
  bots/           lógica serverless (Medplum Bots)
  scripts/        operación: cargas, verificaciones, doctores
data/             catálogos versionados (biomarcadores, medicamentos, marcas)
docs/             decisiones y relevamientos
```

## Puesta en marcha

```bash
cp .env.defaults .env   # opcional: se copia solo al correr `npm run dev`
npm install
npm run build:bots      # requiere credenciales del servidor
npm run dev             # http://localhost:3008
```

Variables de entorno en `.env.defaults`. Vite solo expone las que empiezan con
`MEDPLUM_` o `GOOGLE_`.

## Calidad

```bash
npm run lint
npm test
```

## Sobre Medplum

[Medplum](https://www.medplum.com/) es un EHR open-source, API-first. Este repo
nació como fork del [Medplum Charting Demo](https://github.com/medplum/medplum-chart-demo)
y corre contra una instancia **self-hosted**.

- [Documentación](https://www.medplum.com/docs)
- [Componentes React](https://storybook.medplum.com/)

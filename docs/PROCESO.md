# BioWellness · Seguimiento — Proceso y evolución del proyecto

> Documento integral de **todo lo construido** en el repositorio `dashboard`,
> desde su creación hasta hoy. Pensado para que un colega o institución nueva
> entienda de dónde viene la herramienta, cómo está armada y qué hace cada pieza.
> (No cubre la estética/branding; se enfoca en el producto y la ingeniería.)

Última actualización: 2026-07-23 · branch de trabajo `claude/nice-fermat-nuftrr` · último hito: recetario de órdenes de laboratorio (Fase 1).

---

## 1. Qué es

**BioWellness · Seguimiento** es una aplicación clínica construida sobre
**Medplum** (EHR open-source, API-first, basado en **FHIR R4**). Acompaña a un
paciente a lo largo del tiempo con foco **Cardio-Reno-Metabólico (CKM)** y, de a
poco, hacia **medicina de optimización / BioHacking**:

- **Riesgo cardiovascular** con las ecuaciones **PREVENT** (AHA 2024): ASCVD 10a,
  Insuficiencia Cardíaca 10a y ECV total 30a.
- **Estadío CKM** (0–4) según la guía AHA/ACC/ADA/ASN.
- **hGraph** (GoInvo): visualización radial del estado metabólico del paciente.
- **Panel de biomarcadores BioWellness** (50 marcadores en 10 paneles) con rangos
  convencional y óptimo (Medicina 3.0), leídos como fuente de verdad FHIR.
- **Bots** (backend serverless de Medplum) que recalculan todo al llegar datos,
  generan alertas y planes de cuidado con IA.

El stack: **React 19 + Mantine 8 + TypeScript** (frontend), **Medplum Bots**
(backend), **FHIR** como modelo de datos, **Vite/Vitest** como tooling.

---

## 2. Línea de tiempo

El repo nació como el **Medplum Charting Demo** (starter de charting: ciclo de
vida de Encounters y notas clínicas). Sobre esa base se construyó toda la suite.

| Fase                    | Cuándo    | Qué se construyó                                                                                                                                                                            | Trazabilidad                        |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **0. Base**             | —         | Medplum Charting Demo: Encounters, notas (`ClinicalImpression`), Observations, bots de nota (general/gineco/obstétrica).                                                                    | `src/bots/core`, `src/components/*` |
| **1. Suite CKM**        | jun 11–17 | hGraph + panel PREVENT, estadío CKM, dashboard `/ckm`, bot `ckm-recalculate`, alertas por email, SDOH, AccessPolicies, motor PREVENT verificado, simulador What-If, localización Argentina. | PRs #4–#43                          |
| **2. IA y estudios**    | jun 17    | CarePlan IA (Plan Bienestar 100 días), add-on "¿Qué estudios solicitar?".                                                                                                                   | PRs #44–#49                         |
| **3. Scores de riesgo** | jun 24    | Etapas 1–4: categorización clínica de los scores, los 3 scores en el listado, ApoB/Lp(a) como potenciadores, CAC como reclasificador.                                                       | Commits `f4b8fe3`…`7b0cf82`         |
| **4. Biomarcadores**    | jun 24    | Etapas 5–8: bundle de ObservationDefinitions como fuente de verdad FHIR, panel por categoría, seed demo, tendencias (sparklines).                                                           | `afb5c2c`…`71262ac`                 |
| **5. Calidad y marca**  | jun 24–25 | Etapa 9: fixes de la revisión adversarial 3–8. Etapa 10: marca BioWellness (logo + theme cobre + login).                                                                                    | `5f0b388`, `89be7da`                |

---

## 3. Fase 0 — La base (Medplum Charting Demo)

El punto de partida fue el starter de charting de Medplum:

- **Ciclo de vida del Encounter** y sus notas, modeladas como `ClinicalImpression`.
- **Conversión de notas a datos estructurados** (`Observation`, `Condition`).
- **Bots de nota de encuentro** (`src/bots/core`): `general-encounter-note`,
  `gynecology-encounter-note`, `obstetric-encounter-note`, con sus utilidades de
  charting (`charting-utils`, `observation-utils`) y tests.
- **Componentes de chart** (`src/components`): `SoapNote`, `EncounterDetails`,
  `EncounterHeader`, `PatientDetails`, `PatientObservations`, etc.

Todo esto sigue vivo y es la cama sobre la que se montó la suite CKM.

---

## 4. Fase 1 — Suite CKM (Cardio-Reno-Metabolismo)

El núcleo del producto. Se construyó en `src/ckm/` (lógica pura, reutilizable por
frontend y bots) + `src/bots/ckm/` (backend) + `src/scripts/` (operación).

### 4.1 Modelo y datos

- **`constants.ts`**: códigos LOINC de los parámetros CKM (PA, antropometría,
  metabólico, lípidos, renal, cardíaco), URLs de extensiones propias, los 5
  estadíos CKM.
- **`observations.ts`**: lectura unificada de Observations **sin importar el rol**
  que las cargó (paciente vía app "Control" o médico). Tolera la forma canónica
  US Core del panel de presión arterial y la forma legacy. Valida **plausibilidad
  de la PA** (descarta cargas con campos cruzados).
- **`extensions.ts`**: helpers puros para leer/escribir las extensiones CKM del
  `Patient` (estadío, hGraph data, PREVENTInputs).

### 4.2 Scoring y estadío

- **`scoring.ts`**: normaliza cada métrica a un score 0–1 para el hGraph,
  detecta valores críticos y **deriva el estadío CKM** (0–4) desde los últimos
  valores observados.
- **`hGraph` (`components/HGraph.tsx`)**: visualización radial (d3) del estado del
  paciente — el esquema que da identidad a la herramienta.

### 4.3 Motor PREVENT (el corazón del riesgo)

- **`prevent.ts`**: implementación de las **ecuaciones PREVENT (Khan et al.,
  Circulation 2024)**. Coeficientes β aislados y citados, **validados contra el
  vector de referencia oficial de la AHA** (`prevent.test.ts`: mujer 50a →
  14.7/9.2/8.1% exacto). Protegido por el flag `PREVENT_VERIFIED`: si fuera
  `false`, no publica riesgos sin verificar. Acepta colesterol **No-HDL directo**
  (para datos de la app Control).
- **Simulador What-If** (`PreventSimulator`, `/ckm/simulator/:id`): mueve los
  factores modificables y muestra el impacto estimado sobre el riesgo a 10 y 30 años.

### 4.4 Backend (bots) y operación

- **Bot `ckm-recalculate`**: al llegar Observations, recalcula hGraph + estadío +
  scores PREVENT y los persiste como extensiones del `Patient`. Corre en el
  servidor self-hosted (AWS Lambda / vmcontext).
- **Alertas por email (SES)**: empeoramiento de estadío, valores críticos y
  **tendencia "3 strikes"** (`alert-rules.ts` + `verify-alerts`).
- **AccessPolicies**: paciente v1.2 (para Control) y clínico v1.2, con scripts de
  upsert.
- **Scripts de diagnóstico**: `ckm-doctor` (panel) y `ckm-bots-doctor`
  (bots/subscriptions del self-hosted: memberships, reprocess, recreate-subs,
  guards de proyecto) — fruto de mucho troubleshooting de la infra Medplum.
- **Terminología**: import de ValueSets de VSAC, ValueSets self-contained con
  CodeSystem para Problems/Allergies, ValueSet curado de medicación
  cardiometabólica (RxNorm). Mensajes accionables ante HTTP 413.

### 4.5 SDOH y localización

- **Cuestionario SDOH** versionado (`/ckm/sdoh/:id`) + bot que conecta las
  respuestas a `PREVENTInputs`.
- **Localización Argentina**: DNI/CUIL, género autopercibido, perfil `Patient` AR.

---

## 5. Fase 2 — IA y estudios

- **CarePlan IA** (`careplan-generate`, `CarePlanPanel`): genera un **Plan
  Bienestar 100 días** con Claude, como **borrador con aprobación médica** (nunca
  publica sin revisión). Validado end-to-end con `verify-careplan`; latencia
  optimizada con abort claro y aviso de timeout del Lambda.
- **Add-on "¿Qué estudios solicitar?"** (`studies.ts`, `StudiesPanel`): motor de
  reglas + análisis de gaps que sugiere los próximos estudios según el perfil del
  paciente.

---

## 6. Fase 3–5 — Esta sesión (Etapas 1–10)

Trabajo realizado sobre el branch `claude/nice-fermat-nuftrr` (PR #1), en etapas
acotadas, cada una commiteada y testeada. **Foco: scores de riesgo → biomarcadores
→ calidad → marca.**

### Etapa 1 — Categorización clínica de los scores (`f4b8fe3`)

Los % crudos de PREVENT pasan a **niveles clínicos con color** (Bajo/Limítrofe/
Intermedio/Alto). Módulo `risk.ts` (primitiva pura reusable) + `RiskBadge`.
ASCVD usa los cortes de guía ACC/AHA; IC y ECV usan bandas **provisionales
marcadas como tales**.

### Etapa 2 — Los 3 scores en el listado (`9d20b41`)

El listado `/ckm` muestra ASCVD, IC y ECV como columnas **ordenables**, con
"sin dato" siempre al final. Comparador `compareRows` extraído y testeado.

### Revisión 1+2 (`a47d09c`)

Revisión adversarial: contraste WCAG (`autoContrast`), provisionalidad visible
(`*` + leyenda + `aria-label`), **salvedad PCE↔PREVENT** (los cortes son de las
PCE, el score es PREVENT que estima más bajo), test del orden.

### Etapa 3 — Puente BioHacking: ApoB / Lp(a) (`91b9ab5`)

ApoB y Lp(a) como **potenciadores de riesgo** junto a PREVENT (display-only).
Módulo `biomarkers.ts`; lectura en vivo desde el servidor.

### Etapa 4 — CAC como reclasificador (`7b0cf82`)

El score de calcio coronario **ajusta la categoría** de ASCVD (nunca el % de
PREVENT): power of zero (CAC=0 baja), ≥300 a Alto. Solo ASCVD.

### Etapa 5 — Biomarcadores como fuente de verdad FHIR (`afb5c2c`)

Carga las **50 ObservationDefinitions** del panel BioWellness (metabólico,
lipídico, inflamación, micronutrientes, hormonal, renal-hepático, longevidad,
microbiota, tóxicos, autonómico) a Medplum (uploader CLI + UI) y lee sus rangos
**dinámicamente** (`observation-definitions.ts`).

### Etapa 6 — Panel UI de biomarcadores por categoría (`658649c`)

Página `/ckm/biomarkers/:id`: acordeón por panel, con último valor, rangos
convencional/óptimo y estado (Óptimo/Normal/Alto/Bajo) clasificado **agnóstico a
la dirección** y respetando el género.

### Etapa 7 — Seed de biomarcadores demo (`b724d9f`)

Script `seed-biomarkers-demo` que puebla el panel end-to-end. Su test contra las
50 definiciones reales **detectó un bug** del clasificador (Hb con óptimo de una
sola cola), que se corrigió.

### Etapa 8 — Tendencias (sparkline/historial) (`71262ac`)

Columna "Tendencia" con sparkline SVG por biomarcador; el seed escribe una serie
temporal para que haya tendencia que ver.

### Etapa 9 — Fixes de la revisión adversarial 3–8 (`5f0b388`)

Revisión multi-dimensión (31 agentes, 20/25 hallazgos confirmados). Lo más
relevante: el clasificador marcaba "Alto" valores **dentro del óptimo** cuando el
óptimo excede el tope convencional a propósito (T3 Libre, DHEA-S, Testosterona) —
corregido sin reintroducir el caso Hb. Además: CAC negativo/clamp, paginación de
queries, caveats clínicos, a11y.

### Etapa 10 — Marca BioWellness (`89be7da`)

Logo, theme cobre sobrio/clínico, login y landing rebrandeados (ver
`public/README.md` para subir el logo).

### Life's Essential 8 (LE8) — Etapas A–E

Puntaje de salud cardiovascular de la AHA (Lloyd-Jones DM, et al. _Circulation_
2022;146:e18–e43). 8 componentes, cada uno 0–100; el **compuesto** es el
promedio simple de los 8 y **solo se calcula si están los 8** (decisión de
producto). Categoría por componente y compuesto: Alto ≥80 · Moderado 50–79 ·
Bajo <50.

**Arquitectura (separación motor / datos / UI):**

- **A — Motor (`src/ckm/le8.ts`).** Puro y agnóstico de UI: las 8 tablas
  oficiales (dieta, actividad física, tabaco, sueño, IMC, lípidos no-HDL,
  glucosa, presión). `computeLE8(inputs)` devuelve sub-scores + faltantes, y el
  compuesto solo si están los 8. Glucosa: diabético por `Condition` **o** HbA1c
  ≥6.5 / glucemia ≥126; diabético sin HbA1c → dato insuficiente. Presión: −20 si
  hay antihipertensivo.
- **B — Componentes clínicos (`le8-clinical.ts` + `useLE8ClinicalInputs`).**
  Presión, IMC, no-HDL (directo o total−HDL) y glucosa salen de los
  `Observation` reusando `observations.ts` y `clinical.ts` (mismo criterio de
  diabetes/medicación que PREVENT → coherencia).
- **C — Cuestionarios del paciente (`le8-questionnaires.ts` + hook + bundle).**
  El paciente carga 4 `Questionnaire` en bio.medplum.com.ar; el dashboard
  **interpreta** las respuestas (no muestra el formulario en blanco):
  - **Sueño/PSQI** (`le8-sleep-psqi-v1`): scoring estándar de Buysse 1989 →
    índice global 0–21 (dato clínico) + horas reales (ítem 4) → score LE8 por
    duración.
  - **Dieta/MEPA** (`le8-diet-mepa-v1`): 16 ítems binarios → 0–16 → nivel 1–5.
    Crosswalk **provisional** (a calibrar con el equipo médico).
  - **Actividad/Exercise Vital Sign** (`le8-activity-evs-v1`): días × min/día.
  - **Tabaco** (`le8-tobacco-v1`): status/años/vapeo/humo de segunda mano.

  Los `linkId` de `le8-questionnaires.ts` son el contrato que respetan los
  recursos FHIR de `data/ckm/le8-questionnaires.json`. Carga: `npm run upload-le8`
  o `/upload/le8`.

- **D — UI (`LE8Panel`, tab "Salud CV · LE8").** Combina B + C → `computeLE8`.
  Rueda estilo AHA de 8 sectores (uno por componente, color por estado, gris si
  falta) con el compuesto al centro; desglose con la **fuente** de cada dato
  (laboratorio vs cuestionario); PSQI global y MEPA como extras.
- **E — Esta documentación** (+ la rueda AHA).

**Caveats** (marcados en la UI): crosswalk MEPA→nivel provisional; ajuste de
presión por medicación solo si hay antihipertensivos registrados; el compuesto
exige los 8 (sin los conductuales del paciente, queda parcial).

### Operación del bot `ckm-recalculate` (troubleshooting)

El score CKM/PREVENT y el radar NO se calculan en el navegador: los persiste el
bot `ckm-recalculate` en extensiones del `Patient` (`CKM_STAGE_URL`,
`HGRAPH_DATA_URL`), disparado por una Subscription sobre `Observation?code=<CKM>`.
El chart (`useCKMData`) solo lee lo persistido. Si el chart muestra "Sin métricas
CKM registradas" con datos cargados, el problema es del bot, no del front.

Orden de diagnóstico (todo con un ClientApplication **admin** del proyecto):

1. `npm run ckm-bots-doctor` → mirar en orden: **feature `bots`** del proyecto,
   sección **BOTS** (¿desplegado? ¿código presente?), **SUBSCRIPTIONS**
   (¿`status=active`? ¿`endpoint` = el Bot con código? ¿criteria = la esperada?),
   **AUDITEVENTS** (¿corrió? ¿`outcome=0` o error?).
2. Fallas típicas y remedio:
   - Bots **no desplegados** → `npm run build:bots && npm run deploy-bots-server`
     (con `CKM_BOT_RUNTIME=vmcontext` si el server self-hosted no usa AWS Lambda).
   - Subscription apuntando a un **Bot fantasma** (por `ifNoneExist`, un deploy no
     actualiza una sub existente) → `ckm-bots-doctor -- --recreate-subs`.
   - Bot que **corre pero no escribe** → test decisivo `ckm-bots-doctor --
--reprocess <PatientId>` (ejecuta el bot por `$execute`, sin Subscription) y
     revisar el Patient a mano. Backfill masivo: `--reprocess-all`.
3. **Regla de oro:** el recálculo es lo único crítico y no debe fallar por una
   feature secundaria. Por eso el bot quedó SOLO con el recálculo; las
   notificaciones (alertas de estadío/valores críticos, tendencias, email SES)
   se sacaron (crasheaban el bot en servers sin SES) y vuelven en una etapa
   futura aislada. `alert-rules.ts` y `scoring.detectCriticalValues` quedan como
   lógica pura lista para reusar.

### Reconciliación de LOINC de laboratorio

Distintos laboratorios codifican el mismo analito con LOINC diferentes. El lector
CKM (`observations.ts`) acepta el código primario **+ sinónimos** por parámetro
(`LOINC_SYNONYMS` en `constants.ts`); la escritura usa el primario. Casos
resueltos con datos reales del lab:

- **eGFR**: CKD-EPI 2021 `98979-8`/`98980-6` (además del 2009 `62238-1`). Sin
  esto, PREVENT no ve el eGFR y falta el spoke TFGe.
- **LDL**: medido `2089-1` (además del calculado `13457-7`). **Creatinina**:
  `2160-0`.
- **HbA1c**: IFCC en mmol/mol (`59261-8`) se **convierte a % (NGSP)** al leer
  (`0.09148·IFCC + 2.152`); un valor imposible como % (>20) con unidad ambigua se
  descarta, para no leer una diabetes severa falsa.
- **Lp(a)** (potenciador, `biomarkers.ts`): acepta molar (`102725-2`, `43583-4`)
  y masa (`10835-7`), y **clasifica según la unidad real** de la Observation, no
  el código (evita confundir masa mg/dL con molar nmol/L).

Al cambiar `CKM_OBSERVATION_CODES` cambia el criteria de la Subscription → tras
desplegar, correr `ckm-bots-doctor -- --recreate-subs`.

---

### Recetario de órdenes de laboratorio — Fase 1 (`src/laborders`)

Circuito para que el **médico** solicite los 50 marcadores en 1-2 clicks y para
que el **paciente**, desde el portal, avise que los necesita. Fase 1 construye el
flujo dentro de Medplum (recursos FHIR `ServiceRequest`). La **emisión legal**
(firma electrónica, inscripción en **ReNaPDiS**, Res. 2214/2025) es **Fase 2** y
no vive en el código todavía.

**Modelo FHIR.** Una orden = **varios `ServiceRequest`** (uno por análisis), todos
con el mismo `requisition` (el "número de orden" del formulario de laboratorio),
`category` = _Laboratory procedure_ (SNOMED `108252007`). El flujo médico crea
`intent: 'order'` (`status: 'active'`); el del paciente `intent: 'proposal'`
(`status: 'draft'`), que el médico luego aprueba emitiendo la orden. Se agrupa por
requisición, **no** se usa un único ServiceRequest con 50 códigos.

**Solicitabilidad** (`orderabilityFor`, módulo puro `lab-order.ts`). Clasifica
cada uno de los 50 marcadores:

| Clase             | Qué es                                                                                                                                                               | ¿Se pide?                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `lab` (39)        | Análisis de rutina con LOINC; lo cubren prepagas ABC1 (OSDE, Swiss Medical, OMINT, Medicus).                                                                         | Sí                                                            |
| `specialized` (8) | Estudio de laboratorio especializado sin LOINC de rutina (Edad Biológica/metilación, DunedinPACE, telómeros, NAD+, zonulina, glifosato, PIC AA/EPA, índice Omega-3). | Sí, pero cobertura **no garantizada**                         |
| `derived` (2)     | Se **calcula** de otros: HOMA-IR (glucosa+insulina), eGFR (creatinina).                                                                                              | No por sí mismo — se pide su fuente (`resolveDerivedSources`) |
| `device` (1)      | HRV, se mide con wearable.                                                                                                                                           | No es un análisis                                             |

**UI** (`components/LabOrderPanel.tsx`, tab "Órdenes de laboratorio"): presets de
1 click (perfil completo o por panel), checkboxes por marcador (derivados/wearable
deshabilitados), selector de cobertura (constante `COBERTURAS_PRIVADAS`; sin obras
sociales ni PAMI por ahora) y botón "Generar orden" que crea los ServiceRequest en
un `Bundle` transaccional. Abajo lista las órdenes ya emitidas, agrupadas por
requisición. El requester sale de `medplum.getProfile()` si es Practitioner; si no,
avisa que faltará la matrícula para la emisión legal (Fase 2).

**Cobertura del catálogo** = las mismas 50 `ObservationDefinition` del panel de
biomarcadores (única fuente de verdad, vía `useObservationDefinitions`).

---

## 7. Principios de "herramienta médica"

Convenciones que atraviesan todo el código y conviene mantener:

1. **El motor de riesgo nunca se adultera.** PREVENT está verificado contra el
   vector oficial; las features (categorías, CAC, enhancers) ajustan la
   **presentación/categoría**, nunca el porcentaje calculado.
2. **Lo provisional se marca como tal.** Umbrales sin respaldo de guía (bandas IC/
   ECV, reglas CAC, rangos óptimos Medicina 3.0) están aislados, citados y
   señalizados ("revisar con el equipo médico"), no presentados como verdad dura.
3. **Lógica pura separada de la UI.** `risk.ts`, `biomarkers.ts`,
   `observation-definitions.ts`, `scoring.ts`, `prevent.ts` no dependen de React,
   así las pueden usar también los bots y se testean en Node.
4. **Revisión adversarial antes de mergear.** Dos pasadas (Etapas 1–2 y 3–8) con
   verificación escéptica e independiente de cada hallazgo.

---

## 8. Testing y calidad

- **191 tests** (Vitest, en Node) cubriendo la lógica pura: PREVENT vs vector
  oficial, categorización de riesgo, reclasificación CAC, clasificación de
  biomarcadores (incluidos los bordes que la revisión descubrió), parser de
  ObservationDefinitions, seed, comparador del listado, etc.
- El proyecto **no** testea componentes por render (no hay jsdom/testing-library):
  la lógica relevante vive en funciones puras testeadas; los componentes son
  envoltorios delgados.
- `npm test` corre toda la suite. `npm run build` hace typecheck + build de bots +
  Vite.

---

## 9. Scripts de operación (`package.json`)

| Script                                                              | Para qué                                          |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| `dev` / `build` / `preview`                                         | desarrollo y build                                |
| `test` / `test:coverage`                                            | suite de tests                                    |
| `build:bots` / `deploy-bots-server`                                 | compilar y desplegar los bots al self-hosted      |
| `ckm-doctor` / `ckm-bots-doctor`                                    | diagnóstico del panel y de los bots/subscriptions |
| `import-vsac` / `upload-med-valueset` / `upload-condition-valueset` | terminología                                      |
| `upload-biomarker-defs`                                             | subir las 50 ObservationDefinitions BioWellness   |
| `upload-le8`                                                        | subir los 4 Questionnaire de Life's Essential 8   |
| `seed-ckm-demo` / `seed-biomarkers-demo`                            | datos de demostración                             |
| `verify-prevent` / `verify-alerts` / `verify-careplan`              | validaciones end-to-end                           |
| `upload-access-policy` / `upload-sdoh` / `localize-argentina`       | operación                                         |

La mayoría requieren `MEDPLUM_CLIENT_ID` y `MEDPLUM_CLIENT_SECRET` del
ClientApplication del proyecto.

---

## 10. Mapa del repositorio

```
src/
  ckm/                 # Lógica CKM pura + componentes + hooks (el núcleo del producto)
    prevent.ts         # Motor PREVENT verificado
    risk.ts            # Categorización de riesgo + reclasificación CAC
    scoring.ts         # Score 0-1 del hGraph + derivación de estadío
    observations.ts    # Lectura unificada de Observations CKM
    observation-definitions.ts  # Parser/lector de los biomarcadores (fuente FHIR)
    biomarkers.ts      # Potenciadores de riesgo (ApoB/Lp(a))
    biomarker-seed.ts  # Generación de valores demo
    studies.ts / careplan.ts / alert-rules.ts / argentina.ts
    components/         # HGraph, PREVENTPanel, RiskBadge, RiskEnhancers, Sparkline, ...
    hooks/              # useCKMData, useBiomarkerPanel, useObservationDefinitions, ...
  bots/
    core/               # Bots de nota de encuentro (base chart-demo)
    ckm/                # ckm-recalculate, sdoh-response, careplan-generate
  pages/                # CKMDashboard, BiomarkerPanelPage, SimulatorPage, SDOHForm, SignIn, Landing
  components/           # Componentes de chart + BioWellnessLogo
  scripts/              # Operación, seed, verificación, terminología, diagnóstico
data/
  ckm/                  # biomarker-definitions.json, AccessPolicies, SDOH questionnaire
  core/ / example/      # ValueSets y datos de ejemplo
docs/                   # Esta documentación + integración con Control
```

---

## 11. Estado actual y próximos pasos

**Listo y verificado** (PR #1): scores de riesgo legibles, biomarcadores como
fuente de verdad FHIR con panel y tendencias, dos revisiones adversariales
aplicadas, marca BioWellness.

**Candidatos a futuro:**

- **Recetario Fase 2**: emisión legal de la orden (firma electrónica del médico,
  inscripción en ReNaPDiS / integración con plataforma inscripta, PDF/QR
  imprimible). Requiere abogado y verificación jurisdiccional (PBA). Fase 1 ya
  deja el modelo FHIR (`ServiceRequest` con requisición) sobre el que se apoya.
- **Portal del paciente**: pantalla de 1-2 clicks que crea el `ServiceRequest`
  `intent: 'proposal'` (`buildLabOrder` ya lo soporta) para que el médico apruebe.
- Renderizar más biomarcadores en el hGraph (HOMA-IR, hs-CRP, etc.).
- Filtros/orden por estado en el panel de biomarcadores.
- Endurecer la búsqueda de Observations por `system` (colisión cross-system de
  códigos LOINC — hoy latente, bajo riesgo).
- Multi-institución para comercialización (nombre/branding configurable por tenant).
- Leer los rangos de los biomarcadores 100% dinámicos desde las ObservationDefinitions
  cargadas (hoy ApoB/Lp(a) ya lo hacen; extender al resto del panel).

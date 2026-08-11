# Vademécum SNOMED CT Argentina: opciones y criterio de abordaje

> **Qué es este documento.** El análisis de cómo codificar los medicamentos del
> recetario con SNOMED CT Edición Argentina, las cuatro vías reales de acceso, y
> el plan por fases para BioWellness y para el proyecto Favaloro | Medplum
> Argentina. Hoy la receta lleva la DCI como texto (Ley 25.649, cumplida); la
> codificación SNOMED es lo que la hace **interoperable** — y es el estándar
> nacional definido por la Estrategia de Salud Digital, así que suma al
> expediente ReNaPDiS.

---

## 1. El contexto que cambia todo: Argentina ya tiene la infraestructura

Tres hechos verificados que simplifican el problema:

1. **Argentina es miembro de SNOMED International** (desde 2018). Cualquier
   institución pública o privada del territorio puede pedir una **licencia de
   afiliado gratuita**, aprobada por el Centro Nacional de Terminología en
   Salud, y descargar la **Edición Argentina** (Internacional + extensión
   nacional, que incluye el módulo de medicamentos). Portal:
   `https://mlds.ihtsdotools.org/ar`.

2. **El Estado opera un Snowstorm nacional** (`snowstorm.gob.ar`): el servidor
   de terminología oficial de la Red Nacional de Salud Digital, con la última
   Edición Argentina cargada, acceso mediante **acuerdo de uso** para
   prestadores de salud, y colecciones Postman de implementación — el mismo
   formato de material que ya recorrimos con REFEPS.

3. **El vademécum comercial existe como dato abierto**: el **VNM** (Vademécum
   Nacional de Medicamentos, ANMAT) publica en `datos.salud.gob.ar` los
   productos autorizados con nombre genérico, nombre comercial, laboratorio y
   certificado. No es SNOMED, pero es el puente al nivel marca/presentación
   comercial.

La conclusión de la exploración: **no hay que construir un vademécum; hay que
conectarse a los tres que ya existen**, cada uno para lo que sirve.

---

## 2. Las cuatro vías, de simple a compleja

### A. Snowstorm nacional (`snowstorm.gob.ar`) — consulta en vivo

**Qué es**: usar el servidor estatal como servicio de terminología: FHIR
`ValueSet/$expand` con filtro (autocomplete) y ECL para recortar la jerarquía
de medicamentos.

- **A favor**: cero hosting, contenido oficial siempre actualizado, y el patrón
  de integración ya lo tenemos construido (es un servicio estatal más, como el
  Bus).
- **En contra**: requiere el acuerdo de uso (trámite), y agrega una dependencia
  de disponibilidad estatal en el camino del autocomplete. La lección REFEPS
  aplica entera: _unavailable no puede bloquear la prescripción_ — si el
  servidor no contesta, la DCI tipeada sigue valiendo.

### B. Licencia MLDS + subconjunto como DATO en el repo

**Qué es**: tramitar la licencia de afiliado (gratis), descargar la Edición
Argentina (RF2), y extraer un **subconjunto** de conceptos de medicamentos al
repo como dato — el mismo patrón del catálogo de 109 biomarcadores y del de
terapias Bio: corregir el catálogo no requiere servidor de terminología.

- **A favor**: sin dependencia de runtime, control total, encaja con la
  filosofía del repo. Para el formulario de la práctica (decenas de DCI, no
  miles) es la escala correcta.
- **En contra**: el subconjunto se actualiza a mano con cada release semestral
  de la edición (aceptable: los DCI de la práctica cambian poco).
- **Atención (licencia)**: los conceptos SNOMED son contenido licenciado. El
  uso dentro del territorio miembro con licencia de afiliado está cubierto,
  pero el subset **no debe publicarse en un repositorio público** sin revisar
  los términos. El repo hoy es privado; si eso cambia, este punto se revisa.

### C. Medplum v5: `CodeSystem/$import` en `api.medplum.com.ar`

**Qué es**: Medplum v5 tiene servicios de terminología nativos: `$import` para
cargar sistemas grandes (SNOMED entra: 350k+ conceptos) y `ValueSet/$expand`
con filtro y paginación para autocomplete. Se importa el módulo de medicamentos
de la Edición Argentina (o la edición completa) **una vez en el servidor**, y
cualquier pantalla lo consulta con `$expand`.

- **A favor**: es LA opción para **Favaloro | Medplum Argentina** como
  plataforma multi-proyecto: el CodeSystem se carga una vez (en un proyecto
  compartido/linkeado) y sirve a todos los tenants — BioWellness, Favaloro y
  los que vengan. Sin servidores extra: el que ya está (`Ver-5.1` soporta
  esto).
- **En contra**: requiere escribir el conversor RF2 → formato de `$import`, y
  la actualización semestral es un re-import. Sin soporte ECL completo (para
  eso está D).

### D. Snowstorm propio (Docker + Elasticsearch)

**Qué es**: self-hostear el mismo Snowstorm que corre el Estado, con la Edición
Argentina cargada. Máxima autonomía y ECL completo.

- **En contra**: un servicio más para operar (Elasticsearch incluido), y para
  el caso de uso actual es sobredimensionado. Solo se justifica si C se queda
  corto en capacidades de consulta y A no alcanza en disponibilidad.

### Complemento (cualquier vía): VNM de ANMAT para el nivel comercial

El CSV del VNM mapea genérico ↔ marca ↔ laboratorio ↔ certificado. Sirve para
enriquecer las **presentaciones comerciales** y para validar que una marca
sugerida exista y esté autorizada. Se ingiere como dato con un script (patrón
`upload-biomarker-defs`), sin licencia de por medio.

---

## 3. El criterio de abordaje (por fases)

### Fase 0 — Trámites, en paralelo, esta semana

1. **Licencia MLDS de afiliado** en `mlds.ihtsdotools.org/ar` (gratuita;
   habilita descargar la Edición Argentina). Sin esto no hay B ni C.
2. **Acuerdo de uso del Snowstorm nacional** (Red Nacional de Salud Digital,
   `argentina.gob.ar/salud/terminologia`). Habilita A.
3. **Revisar el catálogo de servicios en `dominios.msal.gob.ar`** con las
   credenciales que ya tenemos del Bus: si el dominio ya incluye un servicio de
   terminología, parte del trámite 2 puede estar hecho.

### Fase 1 — El recetario de BioWellness codifica SNOMED (vía B)

> **Estado**: la Fase 0 está completa (afiliado MLDS vigente desde 2023) y la
> herramienta de extracción existe: `npm run snomed-subset`.

Runbook concreto:

1. En `mlds.ihtsdotools.org/ar` → **Mis Paquetes de la Versión** → descargar
   **dos** paquetes y descomprimirlos bajo un mismo directorio padre en el
   servidor:
   - la **Extensión Argentina** vigente (zip RF2, ~65 MB): trae los conceptos
     creados en el país (ej. tirzepatida) y los refsets del DNM;
   - la **Edición Internacional en Español** de la que esa release declara
     depender (la fecha exacta figura en la release note; ej. la de Mayo 2026
     depende de la del 10-05-2026): trae las descripciones en español de los
     conceptos internacionales (metformina, atorvastatina, ...). Es un zip
     mucho más grande; mismas vías de subida (S3/presigned o wget en el EC2).

   Con solo la extensión, casi todos los DCI salen "sin candidatos" — no es que
   SNOMED no los tenga, es que sus descripciones en español viven en la edición
   base. El script lo avisa cuando detecta ese patrón.
2. `npm run snomed-subset -- --rf2 /ruta/a/la/release` — propone candidatos
   para cada DCI del catálogo **con su FSN a la vista**, clasificados por
   etiqueta semántica: solo `(producto medicinal)` es lo prescribible a nivel
   DCI; la `(sustancia)` es el químico y el `(producto medicinal clínico)` es
   forma+concentración (Fase 2). Las combinaciones ("metformina y
   glibenclamida") se excluyen del matcheo a propósito.
3. `-- --aplicar` escribe en `data/recetas/medicamentos.json` **solo los
   matches únicos e inequívocos**; los ambiguos se eligen a mano con el FSN a
   la vista. Revisar el diff y commitear.
4. `-- --verificar` re-chequea los snomedId cargados contra la release: guardia
   contra typos, y contra conceptos inactivados cuando salga la release
   semestral siguiente.
5. Cuando la edición nombra al medicamento distinto que el formulario (ej.
   "ácidos grasos omega-3" → "ácido graso omega 3 derivado del pescado"), la
   entrada del catálogo lleva `terminoSnomed` con la redacción de la edición:
   el script matchea y re-verifica con ese alias, y el formulario y la receta
   siguen mostrando la DCI de siempre.

Limitación conocida de la pareja extensión + edición en español: ninguno de
los dos paquetes trae el archivo de conceptos de la edición internacional, así
que la actividad de un concepto internacional no es chequeable localmente
(solo la de conceptos argentinos y del módulo español). Ante señales de
inactivación — dos candidatos con el mismo FSN, descripciones inactivas — el
desempate se hace en el navegador oficial (browser.ihtsdotools.org o el
Snowstorm nacional), con el FSN y el estado a la vista.

El `MedicationRequest` sale con
`medicationCodeableConcept.coding = {system: "http://snomed.info/sct", code}`
además del texto; sin código, la receta sigue saliendo como hoy (DCI texto,
legal y válida).

Regla dura: **los conceptId se cargan desde la edición descargada, nunca de
memoria ni de un buscador web** — un código SNOMED equivocado es peor que
ninguno, porque parece verificado. El script no trae ningún código adentro:
todos salen del RF2 que descargaste con tu licencia.

### Fase 2 — Vademécum completo para Favaloro | Medplum Argentina (vía C)

Hallazgo de la release note de Mayo 2026 que simplifica esta fase: la extensión
trae los **refsets del Diccionario Nacional de Medicamentos (DNM)** —
presentaciones y medicamentos comerciales ANMAT, genéricos (clases MP/MPF/CD),
con variantes "en estado comercializado", atributos de expendio controlado
(estupefacientes/psicotrópicos por lista) y un Excel de mapeo a GTIN. Es decir:
el recorte "vademécum argentino" ya viene definido como refset; el conversor
puede importar ese subconjunto en lugar de la jerarquía entera.

Primer entregable de esta fase, ya construido: `npm run snomed-marcas --
--rf2 <dir>` extrae de los FSN de "fármaco de uso clínico comercial" del DNM
el mapeo marca comercial → DCI para los medicamentos del catálogo
(`--aplicar` escribe `data/recetas/marcas.json`). Alimenta el buscador por
marca del módulo Prescripciones: la marca busca, la DCI prescribe.

Segundo entregable: `npm run snomed-vademecum -- --rf2 <dir>` (reporte) /
`--aplicar` con credenciales de client (mismas variables que
`deploy-bots-server`). Es el conversor RF2 → `CodeSystem/$import`: importa al
servidor los miembros de los refsets **"en estado comercializado"** del DNM —
marcas (`574461000221103`) y genéricos droga+dosis+forma (`574471000221107` /
`574481000221105`) — y deja el ValueSet
`https://bio.medplum.com.ar/fhir/ValueSet/vademecum-dnm` listo para
`$expand?filter=` desde el buscador. El recorte es a propósito: son refsets
del módulo argentino (actividad verificable contra el archivo de conceptos de
la extensión, sin el punto ciego de los conceptos internacionales) y
representan el vademécum VIVO según ANMAT — la exploración de la release
20260520 midió ~15.000 marcas y ~15.000 fármacos de uso clínico en el DNM
completo. Re-import semestral con cada release.

Hallazgos de la misma exploración, anotados para después: el paquete trae
refsets de **prácticas de laboratorio de Argentina** (`537301000221103`) y
**prácticas prescribibles de diagnóstico por imágenes** (`536561000221108`) —
candidatos directos para codificar las órdenes de la sección Laboratorio —,
el mapa SNOMED→**NOMIVAC** de vacunas, y refsets de especialidades y
profesiones matriculadas.

Conversor RF2 → `CodeSystem/$import` (script versionado, patrón
`upload-biomarker-defs`), cargado en un proyecto compartido del servidor para
servir a todos los tenants. `ValueSet` de la jerarquía de medicamentos +
`$expand` con filtro para el autocomplete del formulario de recetas, que
reemplaza (o complementa) al catálogo estático. Re-import semestral con cada
release de la edición.

### Fase 3 — Opcional: verificación en vivo (vía A)

Si el acuerdo del Snowstorm nacional sale: un bot `terminologia-verify` (mismo
patrón que `refeps-verify`) que valide el conceptId contra el servidor estatal
al emitir, con la política conocida: _unavailable no bloquea_. Cinturón y
tiradores: el catálogo local resuelve el 99%, el servidor nacional confirma.

### Por qué en este orden

- B primero porque **no agrega dependencias** y con ~10 conceptId el recetario
  ya emite codificado — el beneficio ReNaPDiS se captura en días.
- C después porque es la apuesta de plataforma (multi-tenant) y necesita el
  conversor; se construye una vez y sirve a todos los proyectos.
- A/D solo donde suman: A como verificación cruzada, D solo si hiciera falta
  ECL avanzado self-hosted.

---

## 4. Decisiones que quedan abiertas

1. **Nivel de codificación v1**: producto medicinal (DCI, ej. "metformina") vs
   producto con forma/concentración (ej. "metformina 500 mg comprimido"). Para
   la receta por genérico alcanza el primero; el segundo mapea mejor a
   dispensación. Propuesta: DCI-level en Fase 1, forma/concentración en Fase 2.
2. **Dónde vive el CodeSystem compartido** en el servidor (proyecto linkeado vs
   por-proyecto): decisión de administración de Favaloro | Medplum Argentina.
3. **El VNM**: si se ingiere en Fase 1 (validar marcas sugeridas) o Fase 2.

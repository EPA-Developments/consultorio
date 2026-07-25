# Checklist técnico — art. 4 del Anexo del Decreto 98/23 (inscripción ReNaPDiS)

> **Qué es esto.** Mapeo requisito por requisito entre lo que exige el art. 4 del Anexo del
> Decreto 98/2023 y **lo que la plataforma BioWellness realmente tiene hoy**, verificado
> contra el código fuente. Sirve para (a) dimensionar el trabajo pendiente y (b) preparar el
> "informe de cumplimiento del art. 4" que pide el trámite TAD.
>
> **Método.** Relevamiento normativo multi-fuente + auditoría del repositorio en 5
> dimensiones + **verificación adversarial** de cada afirmación de cumplimiento.
> Complemento de `RECETARIO-FASE2-LEGAL.md` (informe para el abogado).
>
> Fecha: julio de 2026.

---

## ⚠️ 1. Advertencia de método — leer antes que nada

### 1.1 No se pudo leer ninguna fuente oficial

Durante este relevamiento **el 100% del tráfico HTTPS saliente fue bloqueado a nivel de red**
(rechazo en el CONNECT, no solo en los sitios oficiales: fallaron incluso `example.com` y
Wikipedia). Se intentó, sin éxito, acceder a Boletín Oficial, InfoLEG, argentina.gob.ar,
SAIJ, Legisalud y a los sitios de varios estudios jurídicos y colegios profesionales.

**Consecuencia: no hay una sola transcripción literal del articulado.** Todo el contenido
normativo de este documento proviene de **resúmenes de un buscador**, es decir, de una
paráfrasis. Por lo tanto:

- ❌ **Ningún requisito de este documento puede considerarse texto oficial.**
- ❌ **No está confirmado que el listado de requisitos sea exhaustivo** — puede haber
  incisos que los resúmenes no mencionan.
- ❌ **No está confirmado el texto vigente**: el **Decreto 345/2024 modificó el Decreto
  98/2023**, y hay normativa posterior (Res. 5744/2024, Res. 2214/2025, **Disp. 1/2025**)
  que no pudo revisarse.

👉 **Acción obligatoria antes de usar esto para el trámite:** obtener el texto oficial del
Anexo del Decreto 98/2023 (y sus modificatorias) desde una red sin restricciones, y validarlo
con el abogado. Este documento **enmarca** el trabajo técnico; no lo sustituye.

### 1.2 Sobre la auditoría del código (esta parte sí es confiable)

La auditoría del repositorio sí pudo hacerse a fondo. Se aplicó una regla estricta: **solo se
marca "presente" citando `archivo:línea`**, y después cada afirmación pasó por un auditor
escéptico cuyo trabajo era refutarla.

**Resultado: de 67 afirmaciones de cumplimiento, 64 fueron refutadas o degradadas.**
De 38 capacidades inicialmente marcadas como "presentes" quedaron **3**.

La causa dominante de las degradaciones fue siempre la misma: **existe el artefacto, pero no
está aplicado en el circuito real** (una función pura sin llamador, una AccessPolicy
versionada en el repo pero sin evidencia de estar activa en el servidor, una constante que
declara un plazo sin mecanismo que lo haga cumplir).

---

## 2. Veredicto general

> **Hoy la plataforma NO cumple los requisitos del art. 4.** No es un ajuste menor: falta la
> mayor parte de la maquinaria de emisión regulada.

| Estado                            | Capacidades                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| ✅ Presente                       | **3** (y una de ellas es en realidad el hallazgo de un _riesgo_, no una capacidad) |
| 🟡 Parcial                        | **39**                                                                             |
| ❌ Ausente                        | **59**                                                                             |
| ❔ No verificable desde el código | **3**                                                                              |

Esto **no es un fracaso del trabajo hecho**: la Fase 1 se construyó explícitamente como
_documento de trabajo sin validez legal_, y así lo declara el PDF. Lo que muestra el checklist
es la **distancia real** entre eso y una plataforma de emisión inscribible.

### Nota importante sobre el módulo de emisión que ya escribimos

`lab-order-emission.ts` (sello SHA-256, `Provenance` + `Signature`, estado de emisión) aparece
como **ausente** en varias filas. Es correcto y es deliberado: **son funciones puras con
tests, pero todavía no están conectadas al circuito de la aplicación** (no hay acción de firma
en la UI, el sello no se persiste, nadie llama a `verifySeal`). Se dejó así a propósito
esperando la definición legal sobre firma electrónica vs. digital. Para el regulador, **una
capacidad que no está en el circuito no existe**.

---

## 3. Requisito por requisito

Leyenda: ✅ presente · 🟡 parcial · ❌ ausente · ❔ no verificable desde el código

### 3.1 Identificación (identificador único e irrepetible) ❌

|             |                                                                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exige**   | ID único e irrepetible por receta, vinculando profesional–paciente–prescripción, **con el formato que fije el Ministerio** (instrumentado como **CUIR**, legible automáticamente: código de barras/QR).        |
| **Tenemos** | 🟡 Número de requisición propio (`ORD-XXXXXXXX`) que agrupa los `ServiceRequest`, en `lab-order.ts`.                                                                                                           |
| **Falta**   | ❌ **CUIR**: no lo tenemos ni podemos generarlo (lo asigna el sistema nacional tras la inscripción). ❌ Código de barras/QR legible por máquina impreso en la orden. ❌ Garantía de unicidad a nivel nacional. |

### 3.2 Contenido (datos estructurados) 🟡

|             |                                                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exige**   | Secciones tipadas: paciente, profesional firmante **con matrícula/Licencia Sanitaria Federal**, **diagnóstico**, fecha de emisión y prescripción. Validación de campos obligatorios antes de firmar. |
| **Tenemos** | 🟡 Modelo estructurado FHIR: paciente, profesional con matrícula, fecha, ítems con LOINC. Es nuestro punto más fuerte.                                                                               |
| **Falta**   | ❌ **Diagnóstico asociado a la orden** (no se registra). ❌ Validación de matrícula contra **REFEPS** antes de permitir emitir. ❌ Validación server-side que impida emitir con secciones vacías.    |

### 3.3 Vigencia ❌

|             |                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exige**   | **Fecha de inicio de vigencia** (≥ fecha de confección) y plazo de validez. _(Los plazos que aparecieron —30/60 días— NO están confirmados; verificar.)_ |
| **Tenemos** | 🟡 Solo `authoredOn` (fecha de confección).                                                                                                              |
| **Falta**   | ❌ Campo de inicio de vigencia. ❌ Cálculo y control de vencimiento. ❌ Rechazo de la orden fuera de ventana.                                            |

### 3.4 Integridad e inalterabilidad ❌ — _el requisito más exigente_

|             |                                                                                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exige**   | Documento **íntegro e inalterable** tras la firma. Las modificaciones posteriores (dispensa, anotaciones, rúbricas) solo como **registros append-only** anexados, sin tocar el contenido firmado.                                                                       |
| **Tenemos** | 🟡 Las **funciones** de sello SHA-256 y de `Provenance`+`Signature`, con 21 tests. El servidor Medplum versiona recursos.                                                                                                                                               |
| **Falta**   | ❌ **Que el sello se persista y se verifique en el flujo real.** ❌ `Provenance` efectivamente guardado al emitir. ❌ **Mecanismo que impida modificar una orden ya firmada** (hoy nada lo impide). ❌ Control de concurrencia optimista. ❌ Escritura de `AuditEvent`. |

### 3.5 Seguridad y confidencialidad 🟡

|             |                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exige**   | Datos de salud tratados como **datos sensibles** (Ley 25.326): cifrado en tránsito y **en reposo**, control de acceso por rol y por relación, minimización, y **log de auditoría de todo acceso**.                                                                                                                                                                                                                                |
| **Tenemos** | 🟡 HTTPS hacia la API. 🟡 AccessPolicies (paciente/clínico) **versionadas en el repo** con script de upsert — pero versionar el archivo **no prueba** que estén activas. 🟡 Secretos por variables de entorno.                                                                                                                                                                                                                    |
| **Falta**   | ❌ **Registro de auditoría de accesos** (quién leyó qué historia clínica). ❌ Cobertura de las AccessPolicy sobre los recursos que la app **realmente escribe** (`ServiceRequest`, `Provenance`). ❌ **Segmentación entre profesionales**. ❌ Restricción de acceso a `Binary` (PDFs, imágenes). ❌ Cabeceras de seguridad HTTP (CSP, HSTS…). ❌ Timeout de sesión / logout. ❌ Guardas de ruta. ❌ Cifrado en reposo verificado. |

**Riesgos concretos detectados** (a corregir aunque no se inscriba nada):

- ⚠️ **`.env` está trackeado en git y `.gitignore` no tiene ninguna regla `env`** —
  _verificado directamente_. **Matiz importante:** hoy `.env` **no contiene secretos**, solo
  configuración pública del front que Vite expone al navegador igual (`MEDPLUM_BASE_URL`,
  `GOOGLE_CLIENT_ID`, `MEDPLUM_CLIENT_ID`). **No hay credenciales filtradas.** El riesgo es de
  **higiene**: sin regla en `.gitignore`, el día que alguien agregue un secreto real se
  commitea sin fricción.
- ⚠️ `index.html:11` — carga el script de Google Identity (`accounts.google.com/gsi/client`)
  en una página que maneja datos de salud. **Matiz:** la auditoría sugería agregar
  Subresource Integrity, pero **SRI no es aplicable acá** — Google sirve ese script sin
  versionar y actualizándolo, así que un hash fijo rompería el login. Lo correcto es
  **decidir y documentar** si se conserva la dependencia de terceros (y justificarla ante el
  regulador) o se elimina el login con Google.
- ⚠️ Datos clínicos persistidos en **localStorage** del navegador.
- ⚠️ **Datos clínicos enviados a un proveedor externo de IA** sin minimización ni
  pseudonimización documentada.

### 3.6 Interoperabilidad 🟡 — _nuestro punto más fuerte_

|             |                                                                                                                                                                                                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exige**   | Estándares **sintácticos y semánticos** que permitan el intercambio. _(Que sea obligatoriamente HL7 FHIR + SNOMED es una **inferencia** del ecosistema argentino, no una cita del artículo — verificar.)_                                                                                                                     |
| **Tenemos** | 🟡 **FHIR R4 nativo** (no un modelo propietario con exportador). 🟡 **LOINC** en los 50 biomarcadores. 🟡 SNOMED en la categoría de laboratorio. 🟡 Identificadores AR (DNI/CUIL/matrícula).                                                                                                                                  |
| **Falta**   | ❌ Alineación con los **`system` canónicos nacionales** (hoy usamos URIs propias). ❌ **Perfiles FHIR nacionales** / RDIar y `meta.profile` en los datos. ❌ SNOMED CT para diagnósticos. ❌ Publicación de nuestros CodeSystem/ValueSet. ❌ Cobertura/financiador como recurso FHIR. ❌ Exportación estándar hacia terceros. |

### 3.7 Identificación de medicamentos — **no aplica hoy**

Exige DCI/genérico, presentación, forma farmacéutica y cantidad, sin texto libre.
**BioWellness no prescribe medicamentos**, solo órdenes de estudios. ⚠️ **Si alguna vez se
prescriben medicamentos, este requisito se activa por completo** (catálogo de medicamentos,
sin campo libre).

### 3.8 Obligaciones de plataforma ❌ / ❔

| Requisito                                                                                                              | Estado                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Resguardo de credenciales y accesos** (MFA, expiración/revocación de sesión, menor privilegio, rotación de secretos) | ❌ Sin MFA, sin timeout de sesión, sin logout propio                                                    |
| **Servidores en lugar seguro**; constituirse **responsable del tratamiento en territorio argentino**                   | ❔ No documentado. **Verificar si implica residencia local del dato** (incertidumbre normativa abierta) |

### 3.9 Obligaciones de repositorio ❌ / ❔

| Requisito                                                                               | Estado                                                                                                                  |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Alta disponibilidad** conforme al estado del arte (redundancia, failover, SLA medido) | ❔ No verificable desde el código; no hay evidencia de arquitectura redundante ni métricas                              |
| **Persistencia con backup y recuperación probada**                                      | ❌ **Sin evidencia de backups** en el repositorio                                                                       |
| **Retención por el período correspondiente**                                            | ❌ Existe la constante `RETENTION_YEARS = 3`, pero **ningún mecanismo la hace cumplir**, ni impide el borrado prematuro |

### 3.10 Firma del profesional ❌ — _bloqueante legal_

Exige firma electrónica o digital atribuible a persona física, con evidencia de autoría
conservada, y **validación de habilitación contra REFEPS antes de firmar**.

Tenemos el **modelo** (`Provenance` + `Signature`), no la **firma**. Falta la firma efectiva,
la validación REFEPS y la conservación de evidencia. **Sigue bloqueado** hasta definir
electrónica vs. digital (§4.3.8 del informe legal).

---

## 4. Brechas priorizadas

### 🔴 P0 — Riesgos de seguridad (corregir ya, independientemente del trámite)

1. Agregar `.env` a **`.gitignore`** y dejar solo `.env.defaults` versionado. _(No hay
   credenciales expuestas hoy — es prevención, no incidente. No hace falta rotar nada.)_
2. **Minimizar/pseudonimizar** los datos clínicos que se envían al proveedor de IA, y
   documentar la base legal del tratamiento.
3. Sacar datos clínicos de **localStorage** (o cifrarlos/limitarlos).
4. **Cabeceras de seguridad** (CSP, HSTS, X-Frame-Options) en el hosting del front.
5. Decidir y **documentar** la dependencia del script de Google Identity (§3.5).

### 🟠 P1 — Núcleo de emisión regulada (habilita el trámite)

6. **Conectar el sello al circuito**: persistir en la emisión, verificar al leer/imprimir.
7. **Persistir el `Provenance`** de la firma.
8. **Impedir la modificación de una orden firmada** (append-only para lo posterior).
9. **`AuditEvent`**: registrar accesos y emisiones.
10. **Vigencia**: fecha de inicio y control de vencimiento.
11. **Diagnóstico** asociado a la orden.
12. Firma efectiva + **validación REFEPS** _(bloqueado por definición legal)_.

### 🟡 P2 — Infraestructura y datos

13. **Backups** cifrados con **restauración probada** (un backup nunca restaurado no cumple).
14. Mecanismo real de **retención** e imposibilidad de borrado prematuro.
15. Verificar y documentar **AccessPolicies activas**, segmentación entre profesionales,
    acceso a `Binary`.
16. **MFA** y gestión de sesión (timeout, logout, revocación).
17. Documentar **dónde viven los datos** (jurisdicción) y evaluar residencia local.
18. **Inscripción ante la AAIP** (Ley 25.326): responsable + bases de datos.

### 🟢 P3 — Interoperabilidad fina

19. Alinear `system` a canónicos nacionales; adoptar **perfiles RDIar** + `meta.profile`.
20. SNOMED CT para diagnósticos; publicar CodeSystem/ValueSet propios.
21. Corregir inconsistencias detectadas (categoría de `Condition`, LOINC de presión arterial
    entre bots y núcleo CKM, `Observation.category`).

---

## 5. Trámite TAD — documentación (⚠️ sin verificar)

Se completa en **TAD (Trámites a Distancia)**, buscando "receta"/"recetario". Requiere
**Clave Fiscal AFIP/ARCA** de nivel suficiente y apoderamiento electrónico.

Bloques declarados: **solicitante** (nombre y apellido concordante con CUIL/CUIT) · **entidad
/ razón social** · **referente técnico** (bloque obligatorio separado, con CUIT/CUIL) ·
**plataforma** (nombre del software, **versión en producción**, tipo de prescripción) ·
**Declaración Jurada** de cumplimiento (Leyes 25.326, 26.529, 27.553, 25.649) · **informe de
cumplimiento del art. 4** · **documentación respaldatoria**.

⚠️ **La lista concreta de documentos a adjuntar no pudo verificarse.** Está en el Anexo
IF-2024-66861967-APN-DNSISA#MS de la Disposición 1/2024, inaccesible en este relevamiento.

🔎 **Dato nuevo a confirmar con prioridad:** la **Disposición 1/2025** habría incorporado la
exigencia de acreditar un **entorno de fiscalización y control (sandbox espejo de producción)**
accesible a la DNSIS. Si se confirma, es un requisito de infraestructura de peso que no está
contemplado en ninguna estimación previa.

---

## 6. Qué hay que verificar contra fuente oficial

Llevar esta lista junto al informe legal:

1. **Texto oficial y vigente** del art. 4 del Anexo del Decreto 98/2023, con las
   modificaciones del **Decreto 345/2024** y normas posteriores.
2. ¿El listado de requisitos es **exhaustivo**? ¿Cómo está estructurado (incisos a–g, 1–7)?
3. ¿Las obligaciones de **plataforma** y de **repositorio** están dentro del art. 4 o en
   artículos separados? ¿Somos "repositorio" o solo "plataforma prescriptora"? _(Cambia
   sustancialmente las exigencias de disponibilidad y backup.)_
4. **Plazos de vigencia** reales de la prescripción (los 30/60 días no están confirmados).
5. ¿"Responsable del tratamiento en territorio argentino" implica **residencia local del
   dato**?
6. ¿Qué estándar de interoperabilidad es **obligatorio**? (HL7 FHIR/SNOMED es inferencia
   nuestra, no cita.)
7. **Período de conservación** exigido a los repositorios (¿3 años? ¿10 por analogía con
   historia clínica?).
8. Contenido textual de la **DDJJ** y lista de **documentación adjunta** (Anexo de la Disp.
   1/2024).
9. Rol y **responsabilidad personal del referente técnico**.
10. **Arancel** del trámite: no se encontró ninguna mención (ni de costo ni de gratuidad).
11. **Disposición 1/2025**: ¿exige el sandbox de fiscalización?

---

## 7. Cómo seguir

1. **Ahora**: corregir P0 (son riesgos reales, no burocracia).
2. **En paralelo**: conseguir los textos oficiales (§6) y llevarlos al abogado junto con
   `RECETARIO-FASE2-LEGAL.md`.
3. **Con la definición de firma**: ejecutar P1, que es el núcleo del cumplimiento.
4. **Antes de presentar**: P2, y recién entonces armar el informe del art. 4 con evidencia
   real.

> **Criterio que atraviesa todo:** en el informe del art. 4 solo se declara lo que está
> **efectivamente en el circuito**. Una función con tests que nadie invoca no es una
> capacidad — y declararla sería declarar en falso.

# Marca, identificadores y plataforma — decisiones de agosto 2026

> **Qué es esto.** El acta de las cuatro decisiones que convierten al repositorio
> `dashboard` de BioWellness en **Consultorio · Favaloro | Medplum Argentina**
> (`consultorio.medplum.com.ar`), contra el BackEnd `api.medplum.com.ar`.
>
> Se escribe ahora y no después por una razón concreta: el formulario TAD de
> inscripción en el ReNaPDiS pide **nombre de la aplicación** y **URL del sitio**
> (`RENAPDIS-CHECKLIST-TECNICO.md` §5.1). Renombrar antes de presentar es un
> cambio de código; renombrar después es una rectificación ante el Ministerio.

---

## 1. Las cuatro decisiones

| # | Decisión | Qué implica |
| --- | --- | --- |
| 1 | **Reemplazo total de marca** | El producto se llama **Favaloro \| Medplum Argentina**; el módulo, **Consultorio**. «BioWellness» no aparece en ninguna superficie visible. |
| 2 | **Identificadores FHIR congelados** | Los canonical URL existentes **no se tocan**. Un canonical es un identificador, no un cartel. |
| 3 | **Terminología por proyecto linkeado** | SNOMED CT y el vademécum viven en el proyecto **`umls`**; los proyectos clínicos lo consumen por `Project.link`. Una sola copia para todos. |
| 4 | **Deploys separados** | Dos proyectos Vercel del mismo repo, diferenciados por variables de entorno. |

---

## 2. La marca vive en un solo archivo

Todo lo que un humano lee sale de **`src/brand.ts`**:

```ts
name        'Favaloro | Medplum Argentina'   // la plataforma
appName     'Consultorio'                    // el módulo de este deploy
clinicName / clinicSubtitle                  // el membrete del papel emitido
wordmarkLead / wordmarkTail                  // el logo de respaldo
tagline                                      // landing y login
```

Cada valor admite override por entorno con prefijo `MEDPLUM_BRAND_*` (el único
prefijo, junto con `GOOGLE_`, que Vite expone — ver `vite.config.ts`). Eso es lo
que hace posible la decisión 4 sin ramas paralelas del código.

### Qué cambió, superficie por superficie

| Antes | Ahora | Dónde |
| --- | --- | --- |
| `<title>BioWellness · Seguimiento</title>` | `Favaloro \| Medplum Argentina · Consultorio` | `index.html` (además `lang="en"` → `lang="es"`) |
| `BioWellnessLogo` | `BrandLogo` | `src/components/BrandLogo.tsx` |
| Landing y login con copy propio | Copy desde `BRAND` | `LandingPage.tsx`, `SignInPage.tsx` |
| `const CLINIC_NAME = 'BioWellness'` ×2 | `BRAND.clinicName` | `receta-print.ts`, `lab-order-print.ts` |
| "Generado desde BioWellness · Seguimiento." | "Generado desde `brandTitle()`." | pie de receta y de orden |
| `"name": "medplum-chart-demo"` | `"name": "consultorio"` | `package.json` |

**El membrete del papel es lo que más importa** y por eso tiene test propio en
`receta-print.test.ts` y `lab-order-print.test.ts`: si alguien vuelve a clavar un
nombre en el módulo de impresión, el test lo encuentra. Un documento clínico que
se imprime con el emisor equivocado no es un bug cosmético.

### Lo que NO cambió, a propósito

- **La paleta cobre.** Es una decisión de diseño, no de marca, y no formaba parte
  del pedido. Queda abierta (§7).
- **La historia.** `PROCESO.md` es el registro de cómo se construyó esto; las
  menciones a BioWellness en las etapas pasadas se conservan. Reescribir la
  historia para que coincida con el nombre de hoy sería peor que tener dos nombres.
- **La entidad legal.** Ver §6: renombrar el software no define quién se inscribe.

---

## 3. Identificadores congelados — la regla que no se rompe

### La regla

> Los canonical URL de FHIR **no son marca**. Identifican recursos que ya existen
> en `api.medplum.com.ar`. Cambian solo con una migración de datos deliberada,
> nunca como efecto secundario de un cambio de nombre.

### Los dos espacios de nombres, y por qué son dos

| Base | Qué identifica | Origen |
| --- | --- | --- |
| `https://bio.medplum.com.ar/fhir/…` | `sid/receta`, `sid/orden-laboratorio`, `sid/sello-receta`, `sid/sello-orden`, `sid/biomarcador`, `CodeSystem/panel-biomarcador`, `CodeSystem/contexto-rango`, `CodeSystem/diagnosticos-snomed-ar`, `ValueSet/vademecum-dnm`, `ValueSet/diagnosticos-snomed-ar`, los 4 `Questionnaire` de LE8 | El servidor |
| `https://biowellness.ar/fhir/…` | `Questionnaire/nota-evolucion`, `StructureDefinition/refeps-verificacion`, `StructureDefinition/no-solicitable`, `StructureDefinition/itemCodigo`, `CodeSystem/panel`, `CodeSystem/tipo-rango`, `CodeSystem/servicio` | El catálogo (254 apariciones solo en `data/ckm/biomarker-definitions.json`) |

Que sean dos ya era una inconsistencia conocida —`observation-definitions.ts` la
documenta desde hace meses—. **Esta decisión no la resuelve; la congela.**
Unificarlas es un trabajo con nombre propio: se cambia primero en el catálogo,
después en el lector, y con migración de los datos existentes.

### Por qué congelar y no migrar

1. **Hay documentos emitidos con sello de integridad.** `receta-emision.ts` sella
   cada receta con un SHA-256 del contenido clínico y deja un `Provenance` de
   autoría en la misma transacción. El identificador del sello vive bajo
   `sid/sello-receta`. Reescribir el sistema del identifier de una receta ya
   sellada rompe la cadena que prueba que ese documento no fue alterado — y es
   exactamente la capacidad que el art. 4 del Decreto 98/23 exige (§3.4 del
   checklist).
2. **La orden de laboratorio y la receta comparten el gate de emisión.** El mismo
   circuito, los mismos identificadores.
3. **El costo de no migrar es cero para el usuario.** Nadie ve un canonical URL.
   El costo de migrar mal es una historia clínica que no resuelve sus propias
   referencias.
4. **Es la práctica estándar de FHIR.** Un canonical identifica; no describe.

Donde el nombre viejo sigue a la vista en el código, el comentario dice por qué
(`observation-definitions.ts`, `le8-questionnaires.ts`).

---

## 4. Terminología: el proyecto `umls`

### El problema que resuelve

La Fase 2 de `VADEMECUM-SNOMED.md` dejó **17.311 conceptos** del DNM importados
al servidor, y una nota operativa dura ganada a golpes:

> `$import` exige un client **project admin del MISMO proyecto que usa el
> Dashboard** — los recursos nacen en el proyecto del client, e importar con un
> client de otro proyecto los deja invisibles para los médicos.

Con un consultorio eso se resuelve importando en su proyecto. Con N consultorios,
esa solución obliga a N copias de SNOMED y a N re-imports semestrales. El proyecto
`umls` es la salida: **una copia, muchos consumidores.**

### El mecanismo (verificado contra `@medplum/fhirtypes` 5.0.0)

Medplum modela esto con dos campos del recurso `Project`:

| Campo | En qué proyecto va | Qué hace |
| --- | --- | --- |
| `Project.link[].project` | En el **consumidor** (el consultorio) | "Linked Projects whose contents are made available to this one" |
| `Project.exportedResourceType[]` | En el **proveedor** (`umls`) | "The resource types exported by the project when linked" |

**Los dos hacen falta.** Linkear sin exportar es el fallo silencioso de esta
arquitectura: el link existe, la consulta no devuelve nada y nada avisa por qué.

```
Project «umls»                          Project «Consultorio»
  exportedResourceType:                   link:
    - CodeSystem                            - project: Project/<umls>
    - ValueSet                            
    - ConceptMap                          → ValueSet/$expand resuelve
  CodeSystem vademecum-dnm                  vademecum-dnm y
  CodeSystem diagnosticos-snomed-ar         diagnosticos-snomed-ar
```

### Qué cambió en el código

`src/scripts/project-map.ts` sabía una sola forma de tener terminología: que
estuviera en el mismo proyecto que los pacientes. Con el proyecto `umls` esa
heurística reportaría un problema **falso**. Ahora distingue tres casos:

- terminología en el proyecto principal → ✓ ok;
- terminología en un proyecto linkeado **que exporta** `CodeSystem` y `ValueSet` → ✓ ok, "llega por link";
- linkeado **sin exportar**, o en otro proyecto **sin link** → ✗ problema, con el motivo exacto.

Con tests para los tres (`project-map.test.ts`).

### Lo que falta verificar contra el servidor

**✅ Confirmado (19.08.2026):** el proyecto `umls` **ya exporta `CodeSystem` y
`ValueSet`**. El lado del proveedor está listo.

Queda el lado del consumidor. No pude correr nada contra `api.medplum.com.ar`
desde esta sesión (no tengo credenciales acá), así que con `npm run project-map`
y credenciales de super admin falta confirmar:

1. En qué proyecto viven hoy los CodeSystem/ValueSet del vademécum y de diagnósticos.
2. ~~Que el proyecto `umls` declare `exportedResourceType` con **`CodeSystem` y
   `ValueSet`**.~~ ✅ confirmado.
3. Que el proyecto del consultorio declare el `link` a `umls`. **Este es el que
   falta**: exportar sin que nadie linkee no sirve de nada, igual que linkear sin
   exportar. Los dos lados o ninguno.
4. Que `ValueSet/$expand?filter=` devuelva resultados **con las credenciales del
   médico**, no solo con las de super admin. Es la misma distinción que originó
   este script: "¿existe el recurso?" y "¿puede verlo ESTA credencial?" son dos
   preguntas distintas.

Los canonical del ValueSet no cambian (§3), así que **el frontend no necesita
ningún cambio** para esta migración: `vademecum.ts` sigue pidiendo
`https://bio.medplum.com.ar/fhir/ValueSet/vademecum-dnm` y le empieza a responder
el proyecto linkeado. Ese es, precisamente, el beneficio de haber congelado los
identificadores.

### La política que se mantiene

El vademécum **nunca bloquea la prescripción**. Es la lección REFEPS, ya cableada:
si `$expand` no responde, el buscador cae al catálogo local y la receta sale igual
(DCI en texto, legal y válida). Un proyecto de terminología caído no puede dejar a
un paciente sin receta.

---

## 5. Despliegue

| | Consultorio | Dashboard (legado) |
| --- | --- | --- |
| Dominio | `consultorio.medplum.com.ar` | `dashboard.biowellness.ar` |
| Repo | `EPA-Developments/consultorio` | el mismo |
| Marca | por defecto (`src/brand.ts`) | override `MEDPLUM_BRAND_*` si se lo quiere conservar |
| BackEnd | `https://api.medplum.com.ar` | `https://api.medplum.com.ar` |

Dos proyectos Vercel del mismo repositorio, diferenciados **solo por variables de
entorno**. No hay ramas paralelas ni forks: un fork de branding es una deuda que
se paga en cada bugfix.

`vercel.json` no necesita cambios de origen: el `connect-src` del CSP ya apunta a
`https://api.medplum.com.ar`, que es el BackEnd de los dos deploys. Sí conviene
revisar, al dar de alta el dominio:

- que `consultorio.medplum.com.ar` quede en el `Redirect URI` / dominios
  permitidos del `ClientApplication` que use el login;
- el CSP sigue en **`Report-Only`** (`SEGURIDAD.md` §4.1) — el cambio de dominio
  es un buen momento para mirar los reportes antes de hacerlo obligatorio.

---

## 6. Impacto en el trámite ReNaPDiS

El cambio de marca toca **dos campos** del formulario TAD (§5.1 del checklist),
los dos de la sección **Aplicación**:

| Campo | Valor |
| --- | --- |
| Nombre del software | **Consultorio — Favaloro \| Medplum Argentina** |
| URL del sitio | **https://consultorio.medplum.com.ar** |

Y **no toca** los que siguen abiertos, que son de otra naturaleza:

- **Entidad solicitante**: nombre concordante con CUIT, naturaleza privada/pública.
- **Solicitante y referente técnico**: personas físicas, con CUIL y documento.
- **Inscripción de bases de datos ante la AAIP**: trámite previo, con tiempos propios.

Renombrar el software **no define quién se inscribe**. Es una decisión legal, y
está planteada como tal en `RECETARIO-FASE2-LEGAL.md`.

Lo demás del checklist sigue como estaba: REFEPS es requisito de aprobación y ya
está cableado en el gate de emisión; HL7 FHIR es un estándar aceptado; el CUIR lo
asigna el Estado después de la inscripción y hasta entonces la impresión declara
solo lo que puede probar.

---

## 7. Decisiones abiertas

1. **La paleta.** Hoy es cobre, elegida para BioWellness. Favaloro \| Medplum
   Argentina puede querer otra identidad cromática. No se tocó porque no se pidió;
   es un cambio de una línea en `main.tsx` más los tokens.
2. **El logo.** `public/logo.png` no existe en el repo: la app muestra hoy el
   wordmark de respaldo. Con el archivo, aparece la imagen real.
3. **Unificar los dos espacios de nombres FHIR** (§3), con migración de datos.
4. **La entidad que se inscribe en el ReNaPDiS** (§6).
5. **Multi-tenant de verdad**: hoy el membrete del papel es fijo. El día que haya
   más de un consultorio real, el emisor debería salir del `Organization` del
   profesional —la app ya lee el tenant para el saludo del tablero
   (`HomePage.tsx`), el papel todavía no—. `BRAND.clinicName` es el punto exacto
   donde se enchufa ese cambio.

---

## 8. Firma Digital Remota — el PDF que se firma

**Confirmado con el flujo real (agosto 2026):** `firmar.gob.ar/firmador` es un
**portal interactivo, sin API**. El circuito es:

```
Consultorio genera el PDF → el profesional lo sube a firmar.gob.ar →
firma con su certificado → descarga el PDF firmado
```

No hay integración de servicio que hacer: lo que nos toca es **producir el
archivo**. Y ahí estaba el problema.

### Por qué no alcanzaba con "Guardar como PDF"

`printHtmlDocument` escribe HTML en un iframe oculto y llama a `window.print()`.
El PDF sale del diálogo del navegador, lo que significa que:

- **nunca pasa por nuestras manos** — la app jamás ve esos bytes, así que no
  puede hashearlos, guardarlos ni compararlos;
- **no es reproducible** — cambia con el navegador, los márgenes, el tamaño de
  papel y los encabezados que el usuario tenga activados. En la prueba real, el
  navegador le inyectó la URL de la página al pie del documento firmado.

Un documento que se firma tiene que ser determinista: **los mismos datos, los
mismos bytes, siempre**. Es la única forma de probar después que el PDF firmado
es el que emitimos.

### Cómo quedó

- `src/pdf/document.ts` — primitivas: la maqueta se expresa como **datos**
  (bloques con posición) y el dibujo con pdf-lib es un adaptador aparte. Esa
  costura permite testear el documento sin abrir un PDF.
- `src/recetas/receta-pdf.ts` — la maqueta de la receta. Consume el **mismo
  `RecetaPrintData`** que la impresión HTML: el contenido no puede divergir
  entre lo que se ve en pantalla y lo que se firma, solo la maqueta.
- Determinismo verificado por test: las fechas del PDF salen de `authoredOn`
  (no del reloj), se usan fuentes estándar (sin embeber archivos externos) y
  dos generaciones de la misma receta dan **bytes idénticos**.
- El nombre del archivo sigue la convención que ya se usaba a mano:
  `Receta-REC-XXXXXXXX-NombrePaciente.pdf`.
- pdf-lib se carga con **import dinámico**: pesa ~430 kB y solo hace falta al
  bajar un PDF, así que no se le cobra a quien entra a ver una historia clínica.

### El vínculo entre el PDF firmado y el registro FHIR

La orden de laboratorio imprimía sello de integridad y URL de verificación; **la
receta no**. Se corrigió: sin eso, firmar el PDF firma un documento que nadie
puede cotejar contra la receta guardada, y el sello SHA-256 que ya calculábamos
no servía de nada en el papel.

Ahora el sello viaja impreso, así que **firmar el PDF firma transitivamente el
hash del contenido clínico**. Son dos objetos distintos —el sello cubre el
contenido FHIR, la firma del Estado cubre el PDF— y esto es lo que los ata.

### El camino de vuelta — ✅ hecho

Se firmó una receta generada por el repo y se analizó el archivo que volvió.
Lo que enseñó, verificado sobre el documento real:

| Hallazgo | Valor |
| --- | --- |
| Autoridad certificante | **AC MODERNIZACION-PFDR** (Plataforma de Firma Digital Remota) |
| Tipo de firma | `adbe.pkcs7.detached`, PKCS#7 de 15.000 bytes |
| `ByteRange` | `[0 6514 36516 3451]` — arranca en 0 y **cubre el archivo entero** |
| Identidad del firmante | commonName + `serialNumber` con el **CUIL** |
| Firma visible | **No**: `/Rect[0 0 0 0]`, sin sello visual en la página |

**El hallazgo que lo cambia todo:** firmar es una **actualización incremental**.
Los bytes del PDF que generamos aparecen **intactos, como prefijo exacto** del
archivo firmado — se comprobó byte a byte sobre el documento real.

Combinado con la generación determinista, eso habilita una verificación fuerte
y casi gratis: **se regenera el PDF de la receta y se compara con el principio
del firmado**. Si coincide, el documento que alguien firmó es exactamente el que
emitimos. Sin determinismo esta comparación no existiría.

`src/pdf/signed-pdf.ts` verifica cuatro cosas:

1. el contenido firmado **es el nuestro** (prefijo exacto);
2. la firma **cubre todo el archivo** (nada colado fuera del `ByteRange`);
3. el **resumen firmado coincide** con los bytes (SHA-256 contra el atributo
   `messageDigest` del PKCS#7): detecta alteraciones posteriores a la firma;
4. el **CUIL del firmante** es el del profesional que prescribió.

⚠️ **Lo que NO hace, y hay que decirlo:** no valida la cadena de certificación,
ni la revocación (CRL/OCSP), ni que la firma matemática corresponda a la clave
del titular. Eso lo hace el validador oficial (firmar.gob.ar → *Validar
documento*). Nunca declarar "firma válida" con esto solo.

`src/recetas/receta-firmada.ts` guarda lo verificado: el PDF como `Binary` +
`DocumentReference` colgado de la receta, y el **PKCS#7 real en
`Provenance.signature.data`** con `sigFormat: application/pkcs7-signature`. Ese
campo estaba modelado y vacío desde que se escribió `lab-order-emission`: era
exactamente esto lo que esperaba.

El orden no es negociable: **primero verificar, después escribir**. Un PDF que
no corresponde a la receta quedaría exhibido como su documento legal, así que
si la verificación falla no se guarda nada — ni el `Binary`.

Los tests usan un **fixture sintético** que reproduce la estructura. Un PDF
firmado real lleva el CUIL, el correo y el certificado de una persona: eso no se
versiona.

### Lo que sigue abierto

- **La firma no es visible en la página** (`/Rect[0 0 0 0]`). Quien recibe el
  papel impreso no ve ninguna marca de que está firmado; el bloque de
  verificación con el sello es hoy lo único que lo sugiere. Decidir si el
  documento debe reservar un área de firma visible.
- **El estado sigue en `signed-internal`.** La firma del profesional acredita
  AUTORÍA; `legally-emitted` requiere la inscripción en el ReNaPDiS y el CUIR
  asignado por el Estado. La firma digital no adelanta ese trámite.
- **La orden de laboratorio ya tiene PDF propio** (`lab-order-pdf.ts`), con las
  mismas primitivas y la misma propiedad de determinismo. Falta el camino de
  vuelta del firmado para órdenes: hoy solo la receta lo tiene
  (`receta-firmada.ts`). El módulo de verificación (`src/pdf/signed-pdf.ts`) no
  es específico de recetas, así que es cablear, no diseñar.

# Seguridad y protección de datos — decisiones y estado

> Documento operativo de las decisiones de seguridad de Consultorio ·
> Favaloro | Medplum Argentina.
> Complementa `RENAPDIS-CHECKLIST-TECNICO.md` (cumplimiento regulatorio).
>
> Última actualización: julio 2026 — cierre de los **P0**.

---

## 1. Qué se resolvió (P0)

| #   | Riesgo                                               | Estado                                     |
| --- | ---------------------------------------------------- | ------------------------------------------ |
| 1   | `.env` versionado en git                             | ✅ **Resuelto** — excluido en `.gitignore` |
| 2   | Datos clínicos enviados a un proveedor externo de IA | ✅ **Verificado + protegido** (§2)         |
| 3   | Datos del paciente persistidos en `localStorage`     | ✅ **Resuelto** (§3)                       |
| 4   | Sin cabeceras de seguridad HTTP                      | ✅ **Resuelto**, CSP en observación (§4)   |
| 5   | Script de terceros (Google Identity)                 | ✅ **Decidido y documentado** (§5)         |

---

## 2. Uso de IA — minimización y base legal

**Dónde se usa:** un único punto, el bot `careplan-generate`, que redacta el **borrador** del
"Plan Bienestar 100 días". El plan se crea como `draft` y **requiere aprobación médica
explícita** para activarse.

**Qué se envía al proveedor (Anthropic).** Se auditó el contexto real
(`CarePlanContext` en `src/ckm/careplan.ts`) y **ya estaba despersonalizado por diseño**: el
tipo estructuralmente **no puede** transportar identificadores.

| Se envía                                         | No se envía                               |
| ------------------------------------------------ | ----------------------------------------- |
| Estadío CKM · **edad en años** (derivada) · sexo | Nombre y apellido                         |
| Métricas clínicas (valor + unidad + estado)      | **DNI / CUIL**                            |
| Scores de riesgo PREVENT                         | **Fecha de nacimiento**                   |
| Nombres de diagnósticos y de medicación          | Domicilio, teléfono, correo               |
| Score SDOH                                       | **Identificadores FHIR** (`Patient/<id>`) |

**Protección contra regresiones.** Se agregó un test que falla si el prompt llega a contener
una fecha, una referencia `Patient/`, un DNI/CUIL o un correo
(`src/ckm/careplan.test.ts` → _"el prompt NO contiene identificadores del paciente"_).
Si alguien agrega un campo identificatorio al contexto, la suite lo detiene.

**Riesgo residual asumido.** Los nombres de diagnósticos y medicación son **texto libre** del
registro clínico: si un profesional escribiera datos identificatorios dentro de ese texto,
viajarían igual. Se considera improbable y de bajo impacto, pero **no está mitigado
técnicamente**.

### ⚖️ Base legal — PENDIENTE de definición

> **Esto no lo resuelve el código.** Enviar datos de salud —aunque estén despersonalizados—
> a un procesador en el exterior requiere una definición legal explícita bajo la
> **Ley 25.326**. Puntos a resolver con el abogado:
>
> 1. ¿El contexto enviado califica como **dato disociado** (fuera del alcance de la ley) o
>    sigue siendo dato personal de salud?
> 2. Si es lo segundo: **transferencia internacional** de datos sensibles → ¿se requiere
>    contrato con cláusulas modelo (Disp. AAIP 60-E/2016)?
> 3. ¿Hay que **informar al paciente** el uso de IA y obtener consentimiento específico?
> 4. Declararlo en la **inscripción de bases de datos ante la AAIP**.
>
> Está incluido como consulta en `RECETARIO-FASE2-LEGAL.md`.

---

## 3. Datos en el navegador (`localStorage`)

**Riesgo:** el buscador guardaba la última búsqueda **completa**, incluidos los `filters`.
Un filtro puede contener apellido, DNI o una referencia al paciente. `localStorage` **es
persistente, no se borra al cerrar sesión** y queda accesible para quien use después esa
computadora — escenario habitual en un consultorio con máquinas compartidas.

**Decisión:** se persisten **solo preferencias de presentación** (tipo de recurso, columnas,
orden). **Los filtros nunca se guardan.**

Implementación: `src/security/search-storage.ts` (módulo puro, 7 tests).

- El saneamiento se aplica **al escribir y también al leer**. Esto último es clave: neutraliza
  los filtros que **ya quedaron guardados** en los navegadores por la versión anterior de la
  app, sin necesidad de que nadie limpie nada a mano.
- Se descartan además los campos no contemplados explícitamente (lista blanca), para que un
  campo nuevo de `SearchRequest` no arrastre PHI sin querer.

**Costo asumido:** al volver al buscador ya no se restaura el último filtro usado. Es una
pérdida menor de comodidad a cambio de no dejar datos de pacientes en el disco.

---

## 4. Cabeceras de seguridad HTTP

Configuradas en `vercel.json` para todas las rutas:

| Cabecera                              | Valor                                                   | Para qué                                 |
| ------------------------------------- | ------------------------------------------------------- | ---------------------------------------- |
| `Strict-Transport-Security`           | `max-age=31536000; includeSubDomains`                   | Fuerza HTTPS                             |
| `X-Content-Type-Options`              | `nosniff`                                               | Evita adivinación de tipo MIME           |
| `X-Frame-Options`                     | `DENY`                                                  | Anti _clickjacking_                      |
| `Referrer-Policy`                     | `strict-origin-when-cross-origin`                       | No filtra URLs con IDs a terceros        |
| `Permissions-Policy`                  | cámara, micrófono, ubicación, pagos, USB deshabilitados | Reduce superficie                        |
| `Content-Security-Policy-Report-Only` | ver archivo                                             | Control de orígenes — **en observación** |

### ⚠️ Por qué el CSP va en Report-Only

Se desplegó a propósito como **`Content-Security-Policy-Report-Only`** y no como política
activa. Un CSP mal calibrado en una app clínica **rompe el login o las llamadas a la API**, y
una caída de producción es peor que la ausencia temporal de la política.

**Cómo activarlo (tarea pendiente):**

1. Desplegar y usar la app normalmente (login con Google incluido).
2. Revisar en la consola del navegador los avisos `Content Security Policy … would have
blocked`.
3. Ajustar los orígenes de la política según lo que aparezca.
4. Cuando no queden violaciones legítimas, **renombrar la key** a
   `Content-Security-Policy` para que empiece a bloquear de verdad.

> ⚠️ **Verificar tras el primer despliegue:** `connect-src` incluye
> `https://api.medplum.com.ar`. Si el servidor Medplum estuviera en otro host, hay que
> corregirlo o el CSP (una vez activo) bloquearía **todas** las llamadas a la API.

---

## 5. Dependencia de terceros — Google Identity

`index.html` carga `https://accounts.google.com/gsi/client` para el "Iniciar sesión con
Google" (`GOOGLE_CLIENT_ID`).

**Sobre Subresource Integrity (SRI):** una revisión automática sugirió agregar SRI. **Se
descartó por incorrecto**: Google publica ese script **sin versionar y lo actualiza**, de modo
que un hash fijo rompería el inicio de sesión apenas Google cambie el archivo. SRI no es
aplicable a este recurso.

**Decisión:** se conserva la dependencia, con estas condiciones:

- El origen está declarado explícitamente en el CSP (`script-src`, `frame-src`).
- **Es prescindible**: si se vacía `GOOGLE_CLIENT_ID`, el login con Google se deshabilita y
  el script deja de ser necesario. Si el regulador objetara la dependencia de un tercero,
  **se puede quitar sin rehacer nada**.
- Debe declararse como proveedor externo en la documentación de la inscripción.

---

## 6. AccessPolicies: quién ve qué

Hay **dos roles** y cada uno tiene su policy versionada en `data/ckm/`:

| Rol                                   | Archivo                        | Alcance                                                                       |
| ------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| **Médico** (consultorio.medplum.com.ar) | `clinician-access-policy.json` | **Todo el proyecto**: ve y edita los pacientes de _Biowellness \| San Isidro_ |
| **Paciente** (app.biowellness.ar)     | `patient-access-policy.json`   | Solo **su propio** compartment                                                |

### La policy del médico

Es la que necesitan **Dr. Conrado López Alonso, Dra. Stephanie Dos Santos y Dr.
Alejandro D'Alessandro** para ver los pacientes del proyecto. No filtra por médico
tratante: da acceso a **todo el proyecto**, que es lo que corresponde a un centro
donde los tres atienden a la misma población.

```bash
npm run upload-access-policy data/ckm/clinician-access-policy.json
```

> ⚠️ **Subirla no alcanza.** Una AccessPolicy **no hace nada** hasta que está
> **asignada en el ProjectMembership** de cada usuario (desde el admin de Medplum:
> _Project → Users → \[usuario\] → Access Policy_). Se puede tener la policy
> perfecta en el repo y los médicos sin acceso.

**Para ver el estado real** (qué policy tiene asignada hoy cada uno):

```bash
npm run access-policy-doctor
```

Lista las policies del proyecto, qué tiene asignado cada miembro, y avisa si algún
Practitioner quedó **sin policy**.

> 🔎 **Ojo con los admin de proyecto.** Un usuario `admin` **no está limitado por
> la AccessPolicy**: ve todo. Si los tres médicos son admin, los permisos ni
> siquiera se están evaluando y parece que "todo funciona". Para probar de verdad
> la policy hay que usar un usuario **no admin**. El diagnóstico lo marca.

### Reglas que faltaban (julio 2026)

A la policy del médico le faltaban recursos que la aplicación **ya usa**, lo que
daría 403 en funciones nuevas:

- **`ServiceRequest`** — las órdenes de laboratorio (crear, leer, aprobar).
- **`Goal`** — los objetivos que crea el Plan Bienestar.
- **`ObservationDefinition`** — el catálogo de biomarcadores del panel.
- **`Bot`** (lectura) — para el botón "Generar con IA".
- **`Provenance`** — la firma/sello de emisión (Fase 2).
- **`DetectedIssue`**, **`CodeSystem`** (lectura).

Ya están agregadas al archivo. **Hay que volver a subirla y verificar.**

### ⚠️ La policy del paciente NO es la que está en uso

El archivo versionado se llama **`HeartInnovations — Patient Self Access v1.2`**
(nombre heredado de la plantilla original de Medplum), pero la policy que
realmente usa el portal es **"Paciente — Portal"**
(`45ff9a4e-e1c6-48d8-aaae-1932aadf216c`) — confirmado por el equipo.

Como `upload-access-policy` hace **upsert por nombre**, hoy ese archivo **no toca
la policy en uso**: apunta a otro recurso.

**No renombrar el archivo sin antes bajar la policy real.** Si se renombra a
"Paciente — Portal" y se sube, el upload **sobrescribe la policy de producción con
el contenido del archivo** — y si al archivo le falta alguna regla que solo existe
en el servidor, se pierde y el paciente empieza a recibir 403. Es exactamente el
accidente que ya pasó una vez.

Secuencia segura:

1. Bajar la policy real: `GET /fhir/R4/AccessPolicy/45ff9a4e-e1c6-48d8-aaae-1932aadf216c`
2. Volcarla al archivo (reemplazando su contenido, incluido el `name`).
3. Agregar encima las reglas versionadas que falten y commitear.
4. Recién ahí correr `upload-access-policy` y verificar que **no cambie nada**.

---

## 7. Lo que sigue abierto (no es P0)

Del checklist de cumplimiento, siguen **ausentes** y son los próximos en prioridad:

- **Registro de auditoría de accesos** (`AuditEvent`): hoy no se registra quién leyó qué
  historia clínica.
- **MFA** y gestión de sesión (expiración por inactividad, cierre de sesión).
- **Backups** con restauración probada, y mecanismo real de retención.
- Verificar que las **AccessPolicy estén activas en el servidor** (hoy solo está versionado
  el archivo) y que cubran los recursos que la app escribe (`ServiceRequest`, `Provenance`).
- **Segmentación entre profesionales** (hoy no está acotado por médico).
- **Cifrado en reposo**: no verificado.

Detalle y priorización completa en `RENAPDIS-CHECKLIST-TECNICO.md` §4.

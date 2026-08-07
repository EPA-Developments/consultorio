# Integración del portal del paciente con el recetario (Fase 1)

> **Dos hilos de coordinación viven acá.** Las secciones 1–8 son el contrato del
> flujo de solicitud de estudios (Fase 1, ya implementado del lado del
> dashboard). La **sección 9** abre un hilo nuevo con **recepción**
> (`recepcion.biowellness.ar`): las sesiones acumuladas de terapias biológicas,
> que el portal va a querer mostrarle al paciente y que el dashboard ya usa como
> umbral de seguridad. Comparten documento porque comparten equipo y proyecto
> Medplum, no porque sean el mismo flujo.

> **Qué es este documento.** El contrato de interoperabilidad entre el
> **dashboard** (médico, `biowellness/dashboard`) y el **portal del paciente**
> (`biowellness/portal`, servido en **app.biowellness.ar**) para el flujo de
> solicitud de estudios. Y a la vez una **guía/prompt de implementación** lista
> para ejecutar en una sesión scopeada al repo `portal`.
>
> El dashboard ya está construido y desplegado. El portal solo tiene que **crear
> `ServiceRequest` compatibles** con lo que el dashboard ya lee: el tab "Órdenes
> de laboratorio" de la ficha del paciente ya muestra las solicitudes del
> paciente con un badge naranja "Solicitud del paciente".

---

## 1. El flujo, de punta a punta

1. **Paciente** (portal, 1-2 clicks): elige un "pack" de estudios (o "mi control
   completo") y toca **Solicitar**. Se crean uno o varios `ServiceRequest` con
   `intent: 'proposal'` y `status: 'draft'`, agrupados por una misma requisición.
2. **Médico** (dashboard): ve la solicitud en el tab "Órdenes de laboratorio"
   con el badge "Solicitud del paciente", la revisa y —en Fase 2— la aprueba
   emitiendo la orden (`intent: 'order'`).
3. **Fase 2** (fuera de alcance): emisión legal (firma electrónica, ReNaPDiS).

El portal **solo hace el paso 1**. No emite órdenes legales ni imprime PDFs con
validez: crea una _solicitud_ que el médico revisa.

---

## 2. Contrato FHIR (NO cambiar sin coordinar con el dashboard)

Cada estudio solicitado es **un `ServiceRequest`**. Todos los de una misma
solicitud comparten el `requisition`. Forma exacta que debe producir el portal:

```jsonc
{
  "resourceType": "ServiceRequest",
  "status": "draft", // draft = propuesta sin emitir
  "intent": "proposal", // el paciente propone; el médico dispone
  "priority": "routine",
  "category": [
    {
      "coding": [
        {
          "system": "http://snomed.info/sct",
          "code": "108252007",
          "display": "Laboratory procedure",
        },
      ],
      "text": "Laboratorio",
    },
  ],
  "code": {
    "coding": [{ "system": "http://loinc.org", "code": "1558-6", "display": "Glucosa en Ayunas" }],
    "text": "Glucosa en Ayunas",
  },
  "subject": { "reference": "Patient/<id-del-paciente>" },
  "requester": { "reference": "Patient/<id-del-paciente>" }, // se pide a sí mismo
  "authoredOn": "2026-07-23T13:30:00.000Z",
  "requisition": {
    "system": "https://bio.medplum.com.ar/fhir/sid/orden-laboratorio",
    "value": "SOL-7F3A2B1C", // id compartido por todos los ServiceRequest de esta solicitud
  },
  "note": [{ "text": "Solicitud del paciente desde el portal." }], // opcional
}
```

**Constantes que deben coincidir con el dashboard** (`src/laborders/lab-order.ts`):

| Constante                              | Valor                                                           |
| -------------------------------------- | --------------------------------------------------------------- |
| `system` de requisición                | `https://bio.medplum.com.ar/fhir/sid/orden-laboratorio`         |
| categoría (SNOMED)                     | `http://snomed.info/sct` · `108252007` · "Laboratory procedure" |
| `system` de identifier del biomarcador | `https://bio.medplum.com.ar/fhir/sid/biomarcador`               |
| intent / status del paciente           | `proposal` / `draft`                                            |
| prefijo sugerido de requisición        | `SOL-` (el médico usa `ORD-`)                                   |

El dashboard busca las órdenes con `ServiceRequest?subject=Patient/<id>&category=108252007&_sort=-authored`
y agrupa por `requisition.value`. Si el portal respeta la tabla de arriba, la
solicitud aparece automáticamente en la ficha del médico.

---

## 3. Catálogo: las mismas 109 ObservationDefinition

El portal y el dashboard comparten el **mismo servidor Medplum** (api.medplum.com.ar).
El catálogo de estudios es el mismo bundle, hoy de **109 `ObservationDefinition`**
(94 del panel canónico de junio 2026 + 15 extras del seed original), ya cargado. Para leerlo (idéntico al dashboard):

```ts
const ods = await medplum.searchResources('ObservationDefinition', { _count: '1000' });
const defs = ods.filter((od) =>
  od.identifier?.some((i) => i.system === 'https://bio.medplum.com.ar/fhir/sid/biomarcador')
);
```

> Nota: `ObservationDefinition.identifier` no es un search param estándar en FHIR
> R4, por eso se trae todo y se filtra en el cliente (mismo motivo que en el
> dashboard).

De cada `ObservationDefinition` interesa:

- `code.coding[0]` → `{ system, code, display }` (LOINC o código local).
- `code.text` → nombre para mostrar.
- `category[0].coding[0]` → panel (`metabolico`, `lipidico`, …) para armar packs.
- `identifier[system=…/biomarcador].value` → slug del marcador.

### Solicitabilidad (qué se puede pedir)

Solo se solicitan los marcadores **`lab`** y **`specialized`**. Se excluyen los
**`derived`** (se calculan de otros) y **`device`** (wearable). Misma lógica que
el dashboard:

**La solicitabilidad la dice el catálogo, no una lista en el código.** El
recurso trae la extensión `no-solicitable`, y `formula-derivado` distingue un
cálculo de un componente de panel:

```ts
const EXT = 'https://biowellness.ar/fhir/StructureDefinition/';
const DEVICE_IDS = new Set(['hrv-variabilidad-frecuencia-cardiaca']);

function isOrderable(od) {
  const id = od.identifier?.find((i) => i.system === BIOMARCADOR_IDENTIFIER_SYSTEM)?.value ?? '';
  if (DEVICE_IDS.has(id)) return false; // wearable: el catálogo NO lo marca (ver §10.2)
  return !od.extension?.some((e) => e.url === EXT + 'no-solicitable' && e.valueBoolean);
}
```

Hoy el catálogo marca **31**: 7 calculados (los que además traen
`formula-derivado`) y 24 analitos del hemograma, que son valores medidos pero no
se piden sueltos.

Para el portal, con mostrar "packs" curados alcanza. (El portal reporta que "Mi
control completo" son hoy ~80 estudios solicitables, por decisión de Product
Owner: un control completo es el panel entero. El contrato no cambia.)

---

## 4. UX del paciente (1-2 clicks)

Pantalla **"Mis estudios"** con packs. Recomendado:

- **"Mi control completo"** (primario) → todos los marcadores solicitables.
- Packs por foco (opcional): **Cardio-metabólico** (paneles `metabolico` +
  `lipidico` + `inflamacion`), **Hormonal**, **Vitaminas y minerales**, etc.
  (un pack = uno o más paneles).
- Cada pack: un botón **"Solicitar"** (1 click) → confirma → crea la solicitud.

Después de enviar:

- Mensaje: _"Tu solicitud fue enviada. Tu médico la va a revisar."_
- **Evitar duplicados**: deshabilitar el botón mientras se envía y, antes de
  crear, chequear si ya hay una solicitud abierta reciente
  (`ServiceRequest?subject=Patient/<id>&intent=proposal&status=draft`); si existe,
  ofrecer "ver solicitud" en vez de crear otra.

---

## 5. Código a crear en el portal (espejo del dashboard)

Mismo patrón que el dashboard: **módulo puro + tests + hook + página**.

### 5.1 `src/laborders/patient-lab-request.ts` (puro, testeable)

```ts
import type { ObservationDefinition, Reference, ServiceRequest } from '@medplum/fhirtypes';

export const REQUISITION_SYSTEM = 'https://bio.medplum.com.ar/fhir/sid/orden-laboratorio';
export const BIOMARCADOR_IDENTIFIER_SYSTEM = 'https://bio.medplum.com.ar/fhir/sid/biomarcador';
export const LABORATORY_CATEGORY = {
  coding: [{ system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' }],
  text: 'Laboratorio',
};

const EXT_NO_SOLICITABLE = 'https://biowellness.ar/fhir/StructureDefinition/no-solicitable';
// Única lista que queda hardcodeada: el catálogo no marca el HRV. Ver §10.2.
const DEVICE_IDS = new Set(['hrv-variabilidad-frecuencia-cardiaca']);

export interface StudyItem {
  biomarcadorId?: string;
  label: string;
  code?: string;
  system?: string;
  panelCode?: string;
  orderable: boolean;
}

export function parseStudy(od: ObservationDefinition): StudyItem {
  const coding = od.code?.coding?.[0];
  const id = od.identifier?.find((i) => i.system === BIOMARCADOR_IDENTIFIER_SYSTEM)?.value;
  return {
    biomarcadorId: id,
    label: od.code?.text ?? coding?.display ?? coding?.code ?? '(sin nombre)',
    code: coding?.code,
    system: coding?.system,
    panelCode: od.category?.[0]?.coding?.[0]?.code,
    orderable:
      !!id && !DEVICE_IDS.has(id) && !od.extension?.some((e) => e.url === EXT_NO_SOLICITABLE && e.valueBoolean),
  };
}

/** Construye las solicitudes (intent 'proposal') del paciente. */
export function buildPatientRequest(params: {
  patient: Reference; // Patient/<id> (subject y requester)
  items: StudyItem[];
  requisitionId: string; // ej. 'SOL-XXXXXXXX'
  authoredOn: string; // ISO
  note?: string;
}): ServiceRequest[] {
  const requisition = { system: REQUISITION_SYSTEM, value: params.requisitionId };
  return params.items
    .filter((i) => i.orderable)
    .map((i) => ({
      resourceType: 'ServiceRequest',
      status: 'draft',
      intent: 'proposal',
      priority: 'routine',
      category: [LABORATORY_CATEGORY],
      code: {
        ...(i.code && i.system ? { coding: [{ system: i.system, code: i.code, display: i.label }] } : {}),
        text: i.label,
      },
      subject: params.patient,
      requester: params.patient,
      authoredOn: params.authoredOn,
      requisition,
      ...(params.note ? { note: [{ text: params.note }] } : {}),
    }));
}
```

### 5.2 Envío (en el componente/página)

```ts
const me = medplum.getProfile(); // Patient del paciente logueado
const patientRef = { reference: `Patient/${me.id}` };
const requisitionId = 'SOL-' + crypto.randomUUID().slice(0, 8).toUpperCase();
const orders = buildPatientRequest({
  patient: patientRef,
  items: packItems,
  requisitionId,
  authoredOn: new Date().toISOString(),
  note: 'Solicitud del paciente desde el portal.',
});
await medplum.executeBatch({
  resourceType: 'Bundle',
  type: 'transaction',
  entry: orders.map((resource) => ({ request: { method: 'POST', url: 'ServiceRequest' }, resource })),
});
```

> **Límite de escrituras por transacción.** El servidor Medplum rechaza una
> transacción con más de **50 operaciones `update` (PUT)** ("Transaction contains
> more update operations than allowed"). Los **`create` (POST) NO cuentan** para
> ese límite, así que crear ~50 solicitudes en una transacción está OK (es lo que
> hace este envío). El límite sí aplica si alguna vez hacés PUT masivos: en ese
> caso fragmentá en tandas de ≤50 (el dashboard ya lo hace al aprobar, con su
> helper `chunk`). Además, asegurate de **filtrar a `orderable`** (excluí HOMA-IR,
> eGFR y HRV): no tiene sentido "solicitar" un valor calculado o una métrica de
> wearable.

### 5.3 Tests (vitest, espejo de `lab-order.test.ts`)

- `parseStudy` marca `orderable: false` para HOMA-IR, eGFR y HRV; `true` para
  glucosa y para un marcador de código local (especializado).
- `buildPatientRequest` produce N ServiceRequest con `intent: 'proposal'`,
  `status: 'draft'`, misma `requisition`, y `subject == requester == Patient/<id>`.
- Omite los no solicitables.

---

## 6. Requisito operativo: AccessPolicy del paciente

**Importante y fuera del código del portal.** Para que el paciente pueda crear
sus `ServiceRequest`, su **AccessPolicy en el servidor Medplum** debe permitir
`create`/`read` de `ServiceRequest` limitado a su propio compartment
(`subject = %patient`). Si hoy la policy del paciente no incluye `ServiceRequest`,
el `executeBatch` va a fallar con 403. Hay que agregar la resource rule antes de
salir a producción. (Reutilizar el mismo criterio de compartment que ya usan las
Observations del paciente.)

---

## 7. Supuestos a confirmar en el repo `portal`

- **Stack**: se asume React + `@medplum/react` + Mantine (como el patient-app de
  Medplum). El **módulo puro y el contrato FHIR son agnósticos de UI**: si el
  portal usa otro kit, adaptar solo la pantalla.
- **Auth**: el paciente entra con su usuario; `medplum.getProfile()` devuelve su
  `Patient`. Confirmar que así sea (no un `Practitioner`/`RelatedPerson`).
- **Rama de trabajo**: crear una rama feature y NO pushear a `main` sin permiso.

---

## 8. Definición de "listo" (Fase 1 portal)

- [ ] Pantalla "Mis estudios" con al menos el pack "Mi control completo".
- [ ] Al solicitar, se crean los `ServiceRequest` (proposal/draft) con el
      contrato de la sección 2.
- [ ] Anti-duplicado: no se pueden disparar dos solicitudes idénticas seguidas.
- [ ] La solicitud aparece en el dashboard (tab "Órdenes de laboratorio") con el
      badge "Solicitud del paciente". ← prueba de integración de punta a punta.
- [ ] AccessPolicy del paciente actualizada para permitir `ServiceRequest`.
- [ ] Tests del módulo puro en verde.

---

### Contraparte en el dashboard (ya hecho / pendiente)

- **Hecho**: el tab "Órdenes de laboratorio" ya lista las solicitudes del
  paciente (badge naranja) junto a las órdenes médicas, agrupadas por requisición,
  con impresión/PDF.
- **Hecho**: acción **"Aprobar y emitir"** — con el profesional logueado, el
  botón sobre una solicitud `proposal/draft` la transforma en orden `order/active`
  sellada con su matrícula (misma requisición, se preserva el `authoredOn` del
  paciente y se deja constancia en una nota). El badge pasa a "Orden médica".
  Es decir: apenas el portal empiece a crear solicitudes, el loop ya cierra de
  punta a punta.

---

# 9. Sesiones acumuladas de terapias biológicas (hilo con recepción)

> **Interlocutor**: el repo de recepción (`recepcion.biowellness.ar`) y el
> portal del paciente. **Estado**: el contador está implementado y mergeado en
> el dashboard (`src/bio/session-count.ts`); faltan datos de recepción, no
> arquitectura.

## 9.1 De qué se trata

El tope de exposición del HBOT no se mide contra la serie en curso sino contra
**todo lo que el paciente lleva hecho en su vida**. Alguien que hace un bloque
diario preparando una maratón y otro seis meses después acumula los dos. A las
100 sesiones el Panel Bio del dashboard pide evaluación médica antes de seguir
indicando.

Para el portal es, además, un número que el paciente quiere ver: _"llevás 34
sesiones de cámara"_. Son el mismo dato con dos usos distintos, y esa diferencia
es la que gobierna todo lo que sigue.

## 9.2 La regla que no se puede romper: comprado ≠ administrado

Un turno `booked` está **pago y reservado**. No dice que el paciente haya
entrado a la cámara. Alguien compra un pack de diez y hace seis; alguien recibe
una sesión de cortesía que no se factura.

Por eso el conteo viaja siempre con su procedencia (`OrigenConteo`):

| Valor           | Qué significa                         | ¿Sirve para mostrarle al paciente? | ¿Sirve como umbral de seguridad? |
| --------------- | ------------------------------------- | ---------------------------------- | -------------------------------- |
| `administradas` | Sesiones registradas al administrarse | Sí                                 | **Sí**                           |
| `facturacion`   | Estimado desde lo comprado            | Sí, aclarando que es estimado      | **No**                           |
| `desconocido`   | Sin determinar                        | No                                 | No                               |

**El portal puede mostrar cualquiera de los tres si dice cuál es. El gate de
seguridad solo acepta `administradas`.** No es una formalidad: un total
estimado por lo comprado, presentado como total, tranquiliza sobre una
exposición oxidativa que nadie midió.

## 9.3 Contrato de lectura (lo que el dashboard ya hace)

Las dos apps comparten el proyecto Medplum
(`7f068d7d-4633-46e9-9eff-d52bc03625b9` en `api.medplum.com.ar`), así que no hay
capa de integración: se leen los `Appointment` directo.

- **Qué cuenta**: `status = fulfilled`. Además, `arrived` y `checked-in` **con
  fecha pasada** — el paciente vino y nadie cerró el turno. Se cuentan de más a
  propósito: el tope pide evaluación, no bloquea, así que contar de menos es el
  error caro. El panel informa cuántos son.
- **Qué no cuenta**: `pending`, `booked`, `proposed`, `waitlist`, `cancelled`,
  `noshow`, `entered-in-error`.
- **Cómo se atribuye la terapia**: por el código de servicio del turno. Se busca
  primero en `Appointment.serviceType[].coding[]` con
  `system = https://biowellness.ar/fhir/CodeSystem/servicio`, y si no está, en
  cualquier extensión cuyo URL termine en `/itemCodigo`.
- **Si aparece un código desconocido**: el conteo se marca no confiable, los
  topes **no se evalúan** y el panel lo dice. Nunca se informa un total parcial
  como si fuera el total.

## 9.4 Lo que hace falta de recepción

1. **La lista completa de códigos de servicio** (los `ActivityDefinition` con
   `identifier.system = .../CodeSystem/servicio`). Hoy el catálogo tiene dos
   confirmados: `HBOT_MONO` e `IHHT`.
   **Ojo con esto**: monoplaza, biplaza y multiplaza son **tres servicios y una
   sola exposición**. El tope de 100 es de HBOT, no de un equipo. El modelo ya
   soporta varios códigos por terapia; hay que decirle cuáles.
2. **Un `Appointment` real en JSON**, de un turno ya cerrado, para fijar el URL
   literal de la extensión del código. El bot de reserva usa `EXT.itemCodigo`
   pero la constante vive en un módulo que todavía no vimos.
3. **Confirmar que el turno llega a `fulfilled`.** `bw-reservar-turno` crea el
   turno en `pending`/`booked` y ahí termina; las transiciones a Llegó / En
   curso / Completado las hace otro módulo. Si en la práctica los turnos quedan
   en `booked` para siempre, el contador da cero — y eso se arregla en
   recepción, no en el dashboard, porque `booked` es facturación.

## 9.5 Sembrado del histórico

**De dónde salen los pagos hoy**: `Coverage` (paquetes y planes, con
`consumirSesionDePlan`), `Invoice`, y MercadoPago como pasarela de la seña. Todo
lo que ya está en Medplum **no necesita exportarse**: es FHIR en el mismo
proyecto y se lee directo.

Lo que sí hay que sembrar es lo **anterior al sistema**. Ahí la única fuente
suele ser la cobranza, y eso está bien **si queda etiquetado como tal**.

**Cómo NO hacerlo**: crear `Appointment` con `status: 'fulfilled'` para cada
sesión histórica. El contador los tomaría como administradas y el histórico
entraría al umbral de seguridad disfrazado de registro clínico. Además inventa
turnos que nunca existieron.

**Cómo sí**: un **saldo inicial por paciente y por terapia** — un recurso con el
total previo y su procedencia — que el contador suma a lo que lee de los turnos.
Cuando hay saldo inicial, la procedencia del total degrada al eslabón más débil:
`administradas` + `facturacion` = `facturacion`.

> **Pendiente en el dashboard**: `contarSesiones()` hoy devuelve siempre
> `origenConteo: 'administradas'`, porque los turnos son su única fuente. Sumar
> el saldo inicial y degradar la procedencia es un cambio chico, pero hay que
> hacerlo **antes** de sembrar nada: si el histórico entra sin que el contador
> sepa degradar, el número queda mal etiquetado desde el día uno.

Con la exportación en la mano (formato libre: CSV, planilla, dump), lo que hace
falta por fila es: paciente identificable, terapia, y cantidad de sesiones o
fecha. Si viene por pack comprado y no por sesión, sirve igual — es
`facturacion`, que es exactamente lo que el campo declara.

## 9.6 Pendiente aparte: contraindicaciones en `Flag`

Recepción guarda las contraindicaciones del paciente como recursos **`Flag`**
(`subject=Patient&status=active`) y su regla R-02 las valida antes de reservar.
El gate del Panel Bio lee **`Condition`**.

Son dos lecturas sobre el mismo paciente que no se ven entre sí: una
contraindicación cargada por recepción hoy es invisible para el Panel Bio, y una
`Condition` de la historia clínica es invisible para la validación de recepción.
Un paciente puede pasar un control y fallar el otro según por dónde entre.

Para reconciliarlas alcanza con saber **con qué sistema de códigos escribe
recepción los `Flag`** — es otro string, no otro diseño.

## 9.7 Definición de "listo" (hilo sesiones acumuladas)

- [ ] Catálogo de servicios completo mapeado a las seis terapias del Panel Bio.
- [ ] Un `Appointment` real confirma el URL de la extensión.
- [ ] Confirmado que recepción cierra los turnos en `fulfilled`.
- [ ] Saldo inicial implementado en el dashboard (con degradación de procedencia).
- [ ] Histórico sembrado y etiquetado `facturacion`.
- [ ] El portal muestra el acumulado al paciente **con su procedencia visible**.
- [ ] `Flag` de recepción y `Condition` del dashboard reconciliados.

---

# 10. Respuestas del dashboard (agosto 2026)

> En respuesta a `respuesta-dashboard-portal-integration.md`. Verificado contra
> el código y contra `data/ckm/biomarker-definitions.json`, no de memoria.

## 10.1 `no-solicitable`: sí, y el problema era peor de lo que reportaron

**Lo leemos.** Ya está implementado: `parseObservationDefinition` parsea
`no-solicitable` y `formula-derivado`, y `orderabilityFor` clasifica con eso.

Tenían razón y se quedaron cortos. La lista hardcodeada tenía **2** entradas; el
catálogo marca **31**. Eran **29 marcadores que el dashboard dejaba pedir** y no
se pueden pedir: los 24 del hemograma, los 4 ratios/derivados que nombraron, y
`testosterona-libre`.

También tenían razón en lo de los componentes de panel, así que hay una
categoría nueva. Antes eran cuatro valores; ahora cinco:

| Clasificación | Se pide | Cuándo                                                 |
| ------------- | ------- | ------------------------------------------------------ |
| `lab`         | sí      | LOINC de rutina                                        |
| `specialized` | sí      | código local, sin nomenclador                          |
| `derived`     | no      | `no-solicitable` **+** `formula-derivado`              |
| `component`   | no      | `no-solicitable` **sin** fórmula → "Viene en el panel" |
| `device`      | no      | wearable (ver 10.2)                                    |

Lo que **no** pudimos mover al catálogo es qué pedir _en lugar_ de un derivado.
`formula-derivado` trae la fórmula en prosa (`"glucosa × insulina / 405"`,
`"CKD-EPI"`), que sirve para mostrarle al médico pero no para armar una orden.
La tabla de fuentes LOINC sigue en el código, reducida a eso solo.

> **Pregunta de vuelta**: `testosterona-libre` está marcada `no-solicitable`,
> pero su propia fórmula dice "…o medir por diálisis en equilibrio". Si se puede
> medir directo, ¿corresponde que esté marcada? Es decisión del catálogo, no
> nuestra.

## 10.2 HRV: los dos identificadores son correctos, y hay una trampa

No hay desalineación. Son campos distintos del mismo recurso:

```jsonc
"identifier": [{ "system": ".../sid/biomarcador", "value": "hrv-variabilidad-frecuencia-cardiaca" }],
"code": { "coding": [{ "system": ".../biomarcador-local", "code": "hrv-rmssd", "display": "HRV (…)" }] }
```

El dashboard filtra por `identifier`, así que el filtro funciona. Ustedes miran
`code.coding[0].code`, que es `hrv-rmssd`. Los dos valores son reales.

**La trampa**: el HRV **no tiene** la extensión `no-solicitable`. Si la
solicitabilidad dependiera _solo_ del catálogo —que es lo que propusieron— **el
HRV pasaría a ser solicitable**, que es justo el bug que querían evitar. Por eso
`DEVICE_IDS` sobrevive como la única lista hardcodeada, y hay un test que falla
si el catálogo empieza a marcarlo.

**Lo mejor sería marcarlo en el catálogo** y que la lista desaparezca. Mientras
tanto queda cubierto por las dos vías.

## 10.3 Son 109: confirmado

El bundle versionado tiene 109 entradas. La sección 3 decía 50 y ya está
corregida, igual que el supuesto de la sección 4 y `app.biowellness.ar` en la
introducción.

## 10.4 `coding[0]`: no, no se usa para matchear resultados

Verificado en las dos rutas que leen resultados entrantes:

- `src/ckm/observations.ts:44` — `codes?.coding?.some(...)`, recorre **todos**
  los codings, y además mantiene un mapa `LOINC_SYNONYMS` explícito para los
  laboratorios que informan con códigos alternativos.
- `src/ckm/biomarkers.ts:160` — `observation.code?.coding?.some(...)`, ídem.

`coding[0]` se usa solo para **emitir** el código canónico y para mostrar. Un
resultado que llegue con el segundo, tercero o cuarto LOINC de la glucosa
matchea bien. Buena pregunta igual: el riesgo era real, la implementación ya lo
cubría.

## 10.5 Quién computa las sesiones: módulo compartido

**No persistan el conteo.** Un conteo persistido queda viejo en cuanto recepción
cierra un turno, y ahí el problema es peor que la divergencia: divergir se nota
(34 vs 31), quedar viejo no. La analogía con los derivados no cierra del todo —
un derivado se calcula de una extracción y no cambia más; el acumulado de
sesiones cambia cada vez que alguien entra a la cámara.

**Módulo compartido.** `src/bio/session-count.ts` es puro (recibe
`Appointment[]`, sin red ni UI) y la parte que de verdad puede divergir —el mapa
de código de servicio a terapia— ya vive en `data/bio/therapy-definitions.json`,
que es dato, no código. Es el mismo patrón del catálogo de biomarcadores.

Lo empaquetamos como quieran (paquete npm, submódulo, o el JSON publicado más
una copia chica del lector). Lo que importa es que **las reglas —qué estados
cuentan y qué código es qué terapia— tengan un solo dueño**.

Si el empaquetado cross-repo resulta caro, la alternativa es un bot con
`Subscription` sobre `Appointment` que mantenga el número actualizado por
evento. Más piezas, pero sin el problema de frescura de persistir a mano.

## 10.6 La verificación de `fulfilled`: no la podemos correr

**No tenemos credenciales de Medplum en este entorno**, así que no podemos
correr `Appointment?status=fulfilled&_summary=count`. Tienen razón en que define
si esto arranca ahora, y en que es un minuto.

Quien tenga acceso al proyecto, la consulta completa que necesitamos son tres:

```
GET /fhir/R4/Appointment?status=fulfilled&_summary=count
GET /fhir/R4/Appointment?status=arrived,checked-in&_summary=count
GET /fhir/R4/Appointment?_summary=count
```

La primera define si hay algo que contar. La segunda dice cuántos turnos
quedaron abiertos (el contador los toma, ver §9.3). La tercera da el
denominador: si la primera da 0 y la tercera da 4.000, no es que no haya
pacientes — es que nadie cierra turnos.

Coincidimos en el criterio: **"0 sesiones" para alguien que hizo 34 es peor que
no mostrar nada.** Por eso el contador ya distingue "no hay dato" de "cero", y
por eso `conteoParaGate()` devuelve `undefined` en vez de ceros cuando no puede
sostener el número.

## 10.7 El saldo inicial va como `Observation`

**`Observation`**, una por paciente y por terapia. Por dos razones:

1. **No hace falta una regla nueva de AccessPolicy.** El paciente ya lee sus
   propias `Observation`. Era su preocupación explícita —los 403 de
   `ServiceRequest` y el 400 de `Subscription`— y con `Observation` no se repite.
2. Es semánticamente lo que es: un hecho registrado sobre el paciente, con
   valor, fecha y procedencia.

Forma propuesta:

```jsonc
{
  "resourceType": "Observation",
  "status": "final",
  "category": [
    {
      "coding": [
        { "system": "https://biowellness.ar/fhir/CodeSystem/observacion-categoria", "code": "sesiones-terapia" },
      ],
    },
  ],
  "code": {
    "coding": [{ "system": "https://biowellness.ar/fhir/CodeSystem/terapia", "code": "hbot" }],
    "text": "Sesiones de HBOT previas al sistema",
  },
  "subject": { "reference": "Patient/<id>" },
  "effectiveDateTime": "<fecha de corte del sembrado>",
  "valueInteger": 34,
  "method": { "coding": [{ "system": "https://biowellness.ar/fhir/CodeSystem/origen-conteo", "code": "facturacion" }] },
}
```

La **categoría propia** importa: sin ella, este recurso aparecería en las
consultas de biomarcadores y contaminaría los paneles. `method` lleva la
procedencia, que es lo que hace que el total degrade a `facturacion`.

## 10.8 La prueba de punta a punta

De acuerdo en que es el único ítem que ninguno de los dos cierra solo, y **no
nos consta que se haya hecho.** Tampoco la podemos correr desde acá: hace falta
una sesión de paciente en el portal y una de médico en el dashboard, al mismo
tiempo, contra el mismo proyecto.

Del lado del dashboard está listo: el tab lista `proposal`/`draft` con el badge
naranja y el botón "Aprobar y emitir" ya convierte a `order`/`active` sellada
con matrícula.

Proponemos hacerla juntos con un paciente de prueba: ustedes crean la solicitud,
nosotros confirmamos que aparece con el badge y la aprobamos, y ustedes verifican
que el estado cambió del lado del portal.

## 10.9 La decisión de producto de 3.4

De acuerdo en que no es de implementación. Aportamos solo la restricción
técnica: con `desconocido` **la pantalla no puede mostrar un número**, ni
siquiera uno tachado o en gris, porque no hay número que mostrar. Que
"desaparezca sin parecer un error" es exactamente el requisito; el contrato solo
exige que no aparezca un dígito.

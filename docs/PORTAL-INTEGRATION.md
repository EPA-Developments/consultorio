# Integración del portal del paciente con el recetario (Fase 1)

> **Qué es este documento.** El contrato de interoperabilidad entre el
> **dashboard** (médico, `biowellness/dashboard`) y el **portal del paciente**
> (`biowellness/portal`, servido en bio.medplum.com.ar) para el flujo de
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

## 3. Catálogo: las mismas 50 ObservationDefinition

El portal y el dashboard comparten el **mismo servidor Medplum** (api.medplum.com.ar).
El catálogo de estudios es el mismo bundle de 50 `ObservationDefinition` ya
cargado. Para leerlo (idéntico al dashboard):

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

```ts
const DERIVED_SOURCES = {
  'homa-ir': ['glucosa-en-ayunas', 'insulina-en-ayunas'],
  'egfr-tfg-estimada': ['creatinina'],
};
const DEVICE_IDS = new Set(['hrv-variabilidad-frecuencia-cardiaca']);

function isOrderable(def) {
  const id = def.biomarcadorId ?? '';
  if (id in DERIVED_SOURCES) return false; // derivado: viene con su fuente
  if (DEVICE_IDS.has(id)) return false; // wearable: no es análisis
  return true; // lab o especializado: solicitable
}
```

Para el portal, con mostrar "packs" curados alcanza; el paciente no necesita ver
los 50 marcadores sueltos.

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

const DERIVED_IDS = new Set(['homa-ir', 'egfr-tfg-estimada']);
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
    orderable: !!id && !DERIVED_IDS.has(id) && !DEVICE_IDS.has(id),
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

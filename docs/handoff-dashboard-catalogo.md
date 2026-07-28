# Handoff para el repo `dashboard` (CKM Dashboard risk scores)

> Copiar este archivo a `docs/` del repo `dashboard` y trabajarlo desde ahí. Es
> autocontenido: no depende de nada del repo `portal`.

## Contexto

El catálogo de biomarcadores pasó de 50 a **107** para cubrir el panel básico de
Biowellness (la orden de laboratorio de longevidad, junio 2026). Los 107 ya están
en el servidor y versionados en `data/ckm/biomarker-definitions.json`.

Al hacerlo aparecieron dos cosas que le tocan a este repo.

---

## 1. `upload-biomarker-defs` falla con más de ~50 biomarcadores

```
$ npm run upload-biomarker-defs
Subiendo 107 ObservationDefinitions a https://api.medplum.com.ar ...
✗ Error: Transaction contains more update operations than allowed
```

`src/scripts/upload-biomarker-definitions.ts` manda el bundle entero en **una sola
transacción**, y el servidor la rechaza por tamaño. Con 50 pasaba; con 107 no. El
script quedó inutilizable justo cuando el catálogo creció.

**Importante:** una transacción es atómica, así que el fallo no dejó el catálogo a
medias — no escribió nada.

### La corrección

Partir el bundle en lotes de 50 y mandar cada uno como su propia transacción. Cada
lote entra entero o no entra, así que no deja el catálogo inconsistente.

```ts
const TAMANO_LOTE = 50;

/** Parte un bundle transaction en varios de a lo sumo `tamano` entradas. */
function partirEnLotes(bundle: Bundle, tamano = TAMANO_LOTE): Bundle[] {
  const entradas = bundle.entry ?? [];
  const lotes: Bundle[] = [];
  for (let i = 0; i < entradas.length; i += tamano) {
    lotes.push({
      resourceType: 'Bundle',
      type: 'transaction',
      entry: entradas.slice(i, i + tamano),
    });
  }
  return lotes;
}
```

Y en el envío, en vez de un `executeBatch(bundle)`:

```ts
const lotes = partirEnLotes(bundle);
let ok = 0;
for (const [i, lote] of lotes.entries()) {
  const resp = await medplum.executeBatch(lote);
  const exitos = (resp.entry ?? []).filter((e) => e.response?.status?.startsWith('2')).length;
  ok += exitos;
  console.log(`  lote ${i + 1}/${lotes.length}: ${exitos}/${lote.entry!.length} OK`);
  // Los errores vienen dentro de cada entrada: sin mirarlos, un lote a medias
  // pasa por exitoso.
  for (const e of resp.entry ?? []) {
    if (!e.response?.status?.startsWith('2')) {
      console.log(`    ERROR ${e.response?.status}: ${e.response?.outcome?.issue?.[0]?.details?.text}`);
    }
  }
}
console.log(`\n${ok}/${bundle.entry?.length} biomarcadores subidos`);
```

Dos detalles que conviene respetar:

- **Revisar el `response` de cada entrada.** El bundle contesta 200 aunque sus
  entradas fallen; contar solo la respuesta global da por buena una carga a medias.
- **Ajustar el límite si hace falta.** 50 es lo que se verificó que acepta este
  servidor. Si más adelante falla con 50, bajarlo.

### Cómo probarlo sin tocar producción

Un servidor HTTP mínimo que rechace transacciones de más de 50, igual que Medplum,
y verificar que llegan 3 lotes (50/50/7) y no uno de 107. Así se probó del lado del
portal antes de correrlo.

---

## 2. La AccessPolicy del paciente corre el mismo riesgo que corría el catálogo

En julio, dos reglas de la AccessPolicy "Paciente — Portal" se aplicaron **a mano**
en el admin de Medplum y nunca llegaron a su archivo fuente:

```json
{ "resourceType": "ServiceRequest", "readonly": true, "criteria": "ServiceRequest?subject=%patient" },
{ "resourceType": "ServiceRequest", "criteria": "ServiceRequest?subject=%patient&intent=proposal&status=draft" },
{ "resourceType": "Subscription", "criteria": "Subscription?type=websocket&author=%patient" }
```

Sin ellas, el paciente recibe **403** al pedir estudios y el chat en tiempo real
deja de actualizarse. Las dos fallas llegaron a la cara del paciente antes de que
alguien las notara.

**El riesgo:** `npm run upload-access-policy` aplica lo que diga su archivo fuente.
Si esas reglas no están ahí, el próximo upload las borra y las dos fallas vuelven.

### Qué hacer

1. Bajar la AccessPolicy real del servidor:
   `GET /fhir/R4/AccessPolicy/45ff9a4e-e1c6-48d8-aaae-1932aadf216c`
2. Compararla con el archivo fuente de `upload-access-policy`.
3. Agregar lo que falte y commitear.
4. Correr `upload-access-policy` y verificar que **no cambie nada** — si cambia,
   el archivo todavía no refleja el servidor.

El espejo de referencia está en el repo `portal`:
`docs/medplum/access-policy-paciente-portal.json`.

---

## Verificación final

Con las dos cosas hechas:

```bash
npm run upload-biomarker-defs   # 107/107, sin error de transacción
npm run ckm-doctor              # catálogo consistente
npm run upload-access-policy    # sin cambios: el archivo ya refleja el servidor
```

Y del lado del portal, que es donde se ve el efecto:

```bash
npm run verificar:panel                                    # 92 de 92 cubiertos
npm run diagnosticar:biomarcadores -- --paciente <id>      # nada quedó suelto
```

---

## Por si sirve de contexto

El catálogo se cargó desde el repo `portal`, que tiene las herramientas del ciclo
—cotejar el panel, emitir definiciones, aplicar, deduplicar, exportar el bundle—.
Todo eso quedó ahí porque nació de un diagnóstico del portal, pero **la fuente de
verdad del catálogo es este repo**. Si en algún momento conviene mudar esas
herramientas acá, el código está en `portal/scripts/` y `portal/scripts/lib/`.

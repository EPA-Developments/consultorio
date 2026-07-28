# Catálogo de biomarcadores: la convención de identificador quedó mezclada

> **Para:** equipo del repo `portal` (que cargó el catálogo de 107).
> **De:** repo `dashboard`.
> **Qué se necesita:** una decisión sobre qué valor va en
> `ObservationDefinition.identifier`. No es urgente-crítico, pero hoy hay código
> roto y tests en rojo esperando esa definición.

---

## Resumen en tres líneas

Al pasar el catálogo de 50 a 107 biomarcadores cambió **qué se guarda en
`identifier`**: antes era un slug descriptivo (`apob`), ahora en la mayoría es el
código LOINC (`1884-6`). Quedaron **las dos convenciones conviviendo**. Eso ya
causó **un bug silencioso en las órdenes de laboratorio** (corregido) y **15 tests
en rojo** en `main` (sin corregir, a la espera de esta decisión).

---

## El dato concreto

De las **107** definiciones del bundle:

|                                     | Cantidad | Ejemplo                           |
| ----------------------------------- | -------- | --------------------------------- |
| `identifier` **es** el código LOINC | **90**   | `identifier: "1884-6"` (ApoB)     |
| `identifier` es un slug descriptivo | **17**   | `identifier: "egfr-tfg-estimada"` |

Los 17 con slug son una mezcla de dos casos distintos:

- **7 sin LOINC** (marcadores propios, no hay código estándar): `dunedinpace`,
  `edad-biologica-metilacion-adn`, `hrv-variabilidad-frecuencia-cardiaca`,
  `nad-plus-intracelular`, `omega-3-epa-plus-dha-indice`,
  `pic-ratio-aa-epa-perfil-de-inflamacion-celular`,
  `zonulina-permeabilidad-intestinal`.
  Acá el slug es **inevitable** y está bien.
- **10 que SÍ tienen LOINC pero conservaron el slug**: `calprotectina-fecal`,
  `colesterol-no-hdl`, `egfr-tfg-estimada`, `fructosamina`,
  `ldl-particulas-ldl-p`, `mercurio-en-sangre`, `plomo-en-sangre`,
  `ratio-psa-libre-total`, `saturacion-transferrina`, `yodo-urinario`.
  **Estos son la inconsistencia**: son idénticos en naturaleza a los otros 90,
  pero se identifican distinto.

Marcadores conocidos que **perdieron su slug**: `apob` → `1884-6`,
`lpa` → `43583-4`, `glucosa-en-ayunas` → `1558-6`, `creatinina` → `2160-0`,
`insulina-en-ayunas` → `20448-7`.

---

## Qué rompió esto

### 1. Bug silencioso en las órdenes de laboratorio — ya corregido

El dashboard tiene marcadores **derivados** que no se piden solos: al pedir
**HOMA-IR** hay que pedir glucosa e insulina; al pedir **eGFR**, creatinina. Esa
relación estaba escrita con los slugs viejos:

```ts
'homa-ir': ['glucosa-en-ayunas', 'insulina-en-ayunas'],
'egfr-tfg-estimada': ['creatinina'],
```

Como esos tres slugs dejaron de existir, **la fuente no se encontraba y no se
agregaba a la orden, sin ningún mensaje de error**. El médico pedía HOMA-IR y la
orden salía **sin glucosa ni insulina**.

Ya está corregido en el dashboard: las fuentes se referencian por **código
LOINC** y la resolución acepta identifier _o_ código. Se agregaron 4 tests atados
al catálogo real para que no vuelva a pasar en silencio.

> Vale la pena que del lado del portal revisen si hay algo equivalente: **cualquier
> lugar que busque un biomarcador por slug** (`apob`, `lpa`, `glucosa-en-ayunas`…)
> hoy no lo encuentra.

### 2. Quince tests en rojo en `main`

`src/ckm/biomarker-seed.test.ts` y `src/ckm/observation-definitions.test.ts`
fallan porque esperan **50 definiciones** y buscan por slug (`apob`, `lpa`,
`glucosa-en-ayunas`, `dhea-s`…).

**No los tocamos todavía**, porque la corrección depende de qué convención se
elija: si los slugs vuelven, los tests están bien como están; si no, hay que
reescribirlos contra LOINC.

---

## La decisión que hace falta

**¿Qué va en `identifier`?**

**Opción A — LOINC en todos los que tengan** (y slug solo en los 7 propios).
Es lo que ya hace el 84 % del catálogo. Ventaja: una sola regla, y el
identificador es el estándar internacional. Desventaja: hay que unificar los 10
que quedaron con slug, y los identificadores dejan de ser legibles.

**Opción B — volver al slug descriptivo en todos.**
Ventaja: legible, estable aunque cambie el LOINC, y **no rompe el código que ya
existe**. Desventaja: hay que reponer el slug en 90 definiciones.

**Opción C — dejarlo mezclado.**
Es el estado actual. La desaconsejamos: **el bug de las órdenes salió justamente
de acá**, y va a volver a pasar cada vez que alguien asuma una convención.

> Desde el dashboard nos adaptamos a cualquiera de las dos primeras. Lo que
> necesitamos es que **sea una sola**, para poder arreglar los tests y sacar los
> parches de compatibilidad.

---

## Una consideración aparte (FHIR)

En FHIR, el lugar del código estándar es **`code.coding`** — que en este catálogo
ya está bien puesto — mientras que **`identifier`** es el identificador _de
negocio_ del recurso. Poner el LOINC en los dos campos es redundante y hace que
cambiar el código (por ejemplo, si mañana se usa otro LOINC para Lp(a)) cambie
también la identidad del recurso.

Por eso, **técnicamente la opción B es la más sólida**: `code.coding` para el
estándar, `identifier` para la identidad estable. Pero es una preferencia, no un
bloqueo: si eligen A, lo implementamos igual.

Dato relacionado: **Lp(a) cambió de LOINC**, de `102725-2` a `43583-4`. Ambos son
válidos pero **están en unidades distintas** (nmol/L vs mg/dL según el
laboratorio). El dashboard ya lee Lp(a) según la **unidad real** de la
observación y no según el código, así que no se rompió — pero conviene saberlo.

---

## Qué pasa mientras tanto

- El dashboard **funciona** con el catálogo de 107.
- El flujo de órdenes está **corregido** y protegido con tests.
- Los 15 tests en rojo **quedan así hasta la decisión**. Están acotados a dos
  archivos y no afectan producción.

## Lo que ya se resolvió de este lado

- `upload-biomarker-defs` ya no falla con 107: manda **lotes de 50**, cada uno
  como transacción propia, y revisa el resultado de cada entrada.
- Las reglas de `ServiceRequest` y `Subscription` de la AccessPolicy del paciente
  quedaron **versionadas** en el repo (antes vivían solo en el admin).
  ⚠️ Antes de correr `upload-access-policy`: el script hace upsert **por nombre**
  y el archivo se llama `HeartInnovations — Patient Self Access v1.2`, mientras
  el handoff apunta a una policy **"Paciente — Portal"** (`45ff9a4e-…`). Si son
  recursos distintos, el upload no toca la que usa el paciente. **¿Nos confirman
  cuál es la buena?**

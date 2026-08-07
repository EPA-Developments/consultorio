# Sesiones acumuladas: lo que el dashboard lee de recepción

> **Qué es este documento.** Qué necesita el Panel Bio del repositorio de
> recepción (`recepcion.biowellness.ar`) para contar las sesiones que un
> paciente lleva hechas, qué ya está resuelto y qué falta. El contador existe y
> está en el circuito (`src/bio/session-count.ts`); lo que falta son tres datos
> concretos, no arquitectura.

---

## 1. Por qué hace falta contar

El tope de exposición del HBOT no se mide contra la serie en curso sino contra
**todo lo que el paciente lleva hecho**. Alguien que hizo un bloque diario para
una maratón y otro seis meses después acumula los dos. El catálogo ya declaraba
esos topes (`limitesAcumulados`) y el motor ya sabía evaluarlos, pero nadie le
pasaba el número: el artefacto existía y no estaba en el circuito.

Ese número sale de los turnos de recepción.

---

## 2. Lo que ya está resuelto

**Comparten proyecto Medplum.** Las dos apps escriben en
`7f068d7d-4633-46e9-9eff-d52bc03625b9` sobre `https://api.medplum.com.ar/`. No
hace falta ninguna capa de integración: el dashboard lee los `Appointment`
directamente, igual que ya lee los del worklist del Home
(`src/home/home-data.ts`).

**La terapia viaja en el turno.** Recepción codifica el servicio en el
`Appointment`, así que un turno se puede atribuir a una terapia. Sin eso el
conteo sería inservible: el tope de 100 sesiones es **de HBOT**, no de todo lo
que el paciente hizo en la casa.

**Los estados de la agenda son los de FHIR.** La leyenda Tentativo / Confirmado
/ Llegó / En curso / Completado corresponde a `pending` / `booked` / `arrived` /
`checked-in` / `fulfilled`.

---

## 3. Lo que falta (tres strings, no arquitectura)

### 3.1 La lista completa de códigos de servicio

El catálogo (`data/bio/therapy-definitions.json`, campo `codigosServicio`) hoy
tiene **dos** códigos, que son los únicos que aparecieron textualmente:
`HBOT_MONO` y `IHHT`. Faltan los de la biplaza, la multiplaza, Red Light,
Recovery Pro, las botas y IV.

Importa que una terapia pueda tener **varios** códigos: monoplaza, biplaza y
multiplaza son tres servicios distintos y **la misma exposición**.

Mientras falten, el contador no inventa: reporta los códigos que no reconoce y
marca el resultado como no confiable. Ver §4.

### 3.2 El URL literal de la extensión del código

El bot de reserva escribe el código en `EXT.itemCodigo`, pero la constante `EXT`
vive en un módulo de recepción que no vimos. Hasta confirmarlo,
`codigoServicioDeTurno()` busca:

1. `Appointment.serviceType[].coding[]` con
   `system = https://biowellness.ar/fhir/CodeSystem/servicio` — el lugar nativo
   de FHIR para esto.
2. Cualquier extensión cuyo URL termine en `/itemCodigo`.

Alcanza con **un `Appointment` real en JSON** para cerrar esto.

### 3.3 Confirmar que el turno se cierra

`bw-reservar-turno` crea el turno en `pending` o `booked` y ahí termina su
trabajo. Las transiciones a Llegó / En curso / Completado las hace otro módulo.

La pregunta concreta: **¿recepción efectivamente mueve el turno a `fulfilled`
cuando la sesión se administra, o los turnos quedan en `booked` para siempre?**
Si quedan en `booked`, el conteo va a dar cero y hay que agregar el cierre en
recepción — no se puede parchear desde acá, porque `booked` significa "pago y
reservado", que es facturación, no registro clínico.

---

## 4. Las tres decisiones del contador

**No confundir comprado con administrado.** Un turno `booked` está pago y
reservado; no dice que el paciente haya entrado a la cámara. Solo cuentan los
turnos que llegaron a un estado de "pasó". Por eso `OrigenConteo` distingue
`administradas` de `facturacion`: para mostrarle un total al paciente alcanza
con lo comprado, para sostener un umbral de seguridad no.

**Ante la duda, contar de más.** El tope de 100 sesiones pide *evaluación*, no
bloquea. Contar de más cuesta una consulta; contar de menos saltea una
evaluación en alguien con exposición oxidativa acumulada. Por eso un turno viejo
que quedó en `arrived` o `checked-in` y nunca se cerró se cuenta igual, y el
número de esos se informa aparte (`sinCerrar`).

**Un conteo incompleto se declara.** Si aparece un código que el catálogo no
reconoce, el conteo sale marcado `confiable: false`, los topes **no se evalúan**
y el panel dice que no se puede determinar el acumulado. Es deliberado: un total
bajo presentado como total es peor que no tener el número, porque tranquiliza
sobre una exposición que nadie midió.

---

## 5. Pendiente aparte: contraindicaciones en `Flag`

Recepción guarda las contraindicaciones del paciente como recursos **`Flag`**
(`subject=Patient&status=active`) y su regla R-02 las valida antes de reservar.
El gate del Panel Bio lee **`Condition`**.

Son dos lecturas distintas sobre el mismo paciente: una contraindicación cargada
por recepción como `Flag` hoy es invisible para el Panel Bio, y una `Condition`
de la historia clínica es invisible para la validación de recepción. Conviene
reconciliarlas, pero para leer los `Flag` hace falta saber con qué sistema de
códigos los escribe recepción — otro string, no otro diseño.

---

## 6. Qué pedirle a recepción, concretamente

1. El seed del catálogo de servicios (los `ActivityDefinition` con
   `identifier.system = https://biowellness.ar/fhir/CodeSystem/servicio`), o
   simplemente la lista de códigos.
2. Un `Appointment` real en JSON, de un turno ya cerrado.
3. El módulo que cambia el estado del turno, para confirmar que llega a
   `fulfilled`.
4. (Para §5) El sistema de códigos con que escribe los `Flag`.

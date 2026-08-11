# Módulo Prescripciones: requerimientos y referencias de UX

> **Estado: v1 implementada** (sección de primer nivel + selector de paciente
> + contexto + emisión por el gate compartido). Las dos referencias están
> relevadas; el backlog de la sección 6 ordena lo que sigue.

## 1. El pedido

Hoy la emisión de recetas vive como una pestaña más dentro de la ficha del
paciente. El pedido es **elevarla a sección de primer nivel** en la
navegación del Dashboard:

```
Inicio
  Mi tablero
CKM
  Panel CKM
Historias clínicas
  Pacientes
Evoluciones
  Todas las evoluciones
  Mis evoluciones
Prescripciones          ← NUEVA sección, al mismo nivel que las anteriores
```

La intención de producto, en palabras del usuario: que al entrar se entienda
que **"estoy ingresando en una opción totalmente nueva"** — un espacio de
trabajo propio del acto de prescribir, no un apéndice del chart. Desde ahí:

1. **Seleccionar el paciente** (buscador propio de la sección).
2. Ver **información relevante y contextual** del paciente (historial de
   recetas y órdenes previas, datos de cobertura).
3. Emitir con un flujo guiado cuyos **campos principales siguen el patrón de
   las recetadoras comerciales argentinas** (referencias abajo), no el de un
   formulario FHIR.

## 2. Referencia A: Recetario (`app.recetario.com.ar`)

Relevado de las capturas del Dr. D'Alessandro (2026-08-11). La cuenta real de
la práctica tiene **6.109 pacientes** cargados ahí — dato en sí mismo (ver
preguntas abiertas).

### Estructura

- Navegación lateral: Inicio · Pacientes · Prescripciones · Plantillas ·
  Calculadoras.
- **Pacientes**: tabla con búsqueda (nombre y apellido, documento, género,
  fecha de nacimiento), paginada. Acciones "Agregar paciente" y "Link
  pacientes".
- **Ficha del paciente**: datos de identidad y cobertura (apellido/s,
  nombre/s, N° de documento, fecha de nacimiento, género, obra social, N° de
  afiliado, email, teléfono) + **timeline** de prescripciones previas
  (fecha · tipo ORDEN/RECETA · "Solicito: …" · etiqueta CONTROL · botón "Ver
  orden"). Botones prominentes: **Nueva Receta** y **Nueva Orden**.

### Flujo "Nueva receta" (wizard de 4 pasos, con dots de progreso)

1. **Datos del Paciente** — pre-poblados si el paciente existe; editables:
   - Apellido\*, Nombre\* ("escribí el apellido y seleccioná el paciente de
     la lista; si no está, completá los datos")
   - DNI\* (solo números, sin espacios ni guiones)
   - Fecha de nacimiento\*, Género\* (M / F / Otro)
   - Obra social/prepaga\* (o "Particular"), Plan, Número de afiliado\*
   - Email, Teléfono (opcionales)
2. **Medicamentos** — dos solapas: **Vademecum | Manual**.
   - Búsqueda única que resuelve **por principio activo O por marca
     comercial**: tipear "Rosuvastatina" lista todas las marcas (APRENTICE,
     ARTOMEY, ASTENDE, ATERONOVA, BILIP 10/20/40, …); tipear "Crestor"
     devuelve la fila `rosuvastatina | CRESTOR`.
   - Resultado en dos columnas: **Principio Activo | Marca Comercial**.
   - Toggles del paso: **Paciente HIV** y **Tratamiento prolongado**
     (condiciones legales/de cobertura de la receta argentina).
   - "Manual" = escape para lo que el vademécum no trae.
3. **Posología**.
4. **Diagnóstico** → finalizar.

## 2b. Referencia B: RCTA (`app.rcta.me`)

Relevado de capturas + el PDF real de una receta emitida (2026-08-11).

### Estructura

- Sidebar con identidad del profesional siempre visible (foto, "Dr. …
  MEDICO, MN: 92179"): Mis Pacientes · Medicamentos · Prácticas ·
  Certificados y otros · Solicitudes de Medicamentos · Configuración.
- **Pacientes**: tabla con Nombre, Identificación (DNI), Institución
  ("Propio"), Sexo, Edad, Email, Cobertura ("Sin cobertura").
- **Crear receta**: página única (no wizard), tarjetas:
  - **Elegir Paciente** arriba de todo; al elegirlo se auto-cargan cobertura
    (Plan, N° de afiliado, checkbox "Sin cobertura") y datos contextuales.
  - **Perfiles de Recetas** (Principal…): identidades/plantillas del emisor.
  - **Otras configuraciones**: toggles "Tratamiento prolongado" y "Ocultar
    datos del paciente" (protege los datos de la persona en la receta).
  - **Fecha de la receta** + "Añadir Fecha": permite emitir la serie de
    recetas posdatadas de un tratamiento prolongado en un solo acto.
  - **Diagnóstico sugerido\*** codificado **CIE-10** (ej. "Z769 - PERSONA EN
    CONTACTO CON LOS SERVICIOS DE SALUD…").
  - **Medicamentos** con `+` que abre el buscador: por genérico **o marca**;
    el ítem agregado ("CRESTOR (rosuvastatina) 10 mg comp.x 28") lleva
    toggles **Recetar sólo genérico**, **Recomendación médica**, **Por
    duplicado**, campos Diagnóstico y Observación por ítem, y stepper de
    cantidad.
  - **Indicaciones** (texto para el paciente) y **Texto adicional** (libre).

### Anatomía del PDF emitido (la salida que importa)

Del PDF real (`prescriptions.rcta.me/....pdf`, verificación en
`verumrp.com.ar/<hash>`):

- Emisor: nombre, "MEDICO - CARDIOLOGIA", **Matrícula Nac.**, domicilio.
- **Creada** / **Válida desde** (fechas separadas — soporta posdatadas).
- Paciente: nombre completo, sexo, **DNI y CUIL**, fecha de nacimiento,
  cobertura (`SWISS MEDICAL | PLAN: SMG20 | N° Credencial: …`) + código de
  barras del N° de credencial.
- **Rp./** con la **DCI en mayúsculas como protagonista**
  ("ROSUVASTATINA - 10 mg comp.x 28"), **cantidad en números y letras**
  ("Cantidad: 1 (uno)"), la marca (CRESTOR) subordinada, y el
  **diagnóstico CIE-10** por ítem.
- Leyenda de firma: "Este documento ha sido firmado -electrónica o
  digitalmente según corresponda- por …" + bloque FIRMA Y SELLO + link de
  verificación.
- Leyenda registral: "Esta receta fue creada por un emisor inscripto y
  validado en el **Registro de Recetarios Electrónicos** del Ministerio de
  Salud de la Nación **RL-2024-100292307**" — el número que BioWellness
  obtendrá con su inscripción (instructivo ya en carpeta).
- Referencia al "Buscador Nacional de Medicamentos".

### Lectura comparada (qué tomamos de cada una)

- De **Recetario**: la búsqueda unificada marca↔genérico en dos columnas y
  el timeline del paciente como contexto.
- De **RCTA**: la página única (mejor que el wizard para un médico que emite
  decenas por día), "Elegir paciente" como primer gesto, la cobertura
  auto-cargada, y sobre todo **la salida**: DCI protagonista + cantidad en
  letras + leyendas legales — que valida nuestro modelo (ellos también
  subordinan la marca a la DCI).

## 3. Cómo encaja el avance de terminología (la pregunta clave)

Lo que Recetario resuelve con su vademécum comercial es **exactamente lo que
ya tenemos en la mano** tras la Fase 1 SNOMED:

| Pieza del flujo Recetario | Nuestro equivalente | Estado |
|---|---|---|
| Búsqueda por principio activo | Catálogo de 10 DCI con conceptId SNOMED nivel producto medicinal | ✅ hecho (Fase 1) |
| Búsqueda por **marca comercial** → principio activo | **Refsets del DNM** de la Extensión Argentina (medicamentos comerciales ANMAT ↔ genéricos, clases MP/MPF/CD, estado de comercialización, mapeo GTIN) y/o **VNM** de ANMAT (dato abierto: genérico↔marca↔laboratorio↔certificado) | Fase 2 — los datos ya están en el zip descargado |
| Vademécum siempre actualizado | Release semestral de la edición + `--verificar` | ✅ rutina establecida |
| "Manual" como escape | Receta libre (DCI tipeada siempre vale) | ✅ ya es nuestro principio |

La diferencia de fondo con Recetario, que es nuestra ventaja legal y de
diseño: en nuestro flujo **la marca nunca es el medicamento**. Se muestra
para buscar (el médico piensa "Crestor"), pero lo que se prescribe es la DCI
(Ley 25.649) y la marca queda como *sugerida, sustituible* — el modelo
`marcaSugerida` que ya existe en `receta.ts`. El coding SNOMED viaja
invisible para interoperabilidad (ReNaPDiS, Red Nacional de Salud Digital).

Es decir: **el buscador marca→DCI del paso 2 es la aplicación concreta de la
Fase 2 del plan SNOMED** (`docs/VADEMECUM-SNOMED.md`): ingerir el recorte
DNM/VNM y servirlo como autocomplete. No hay que licenciar ningún vademécum
comercial de terceros.

## 4. Campos que hoy no modelamos y aparecen en Recetario

A resolver en el diseño (no antes):

- **Paciente HIV** (toggle): implica confidencialidad reforzada y cobertura
  100% (Ley 27.675). ¿Dónde vive en FHIR? Probable `MedicationRequest`
  extension o categoría — definir con cuidado de privacidad.
- **Tratamiento prolongado** (toggle): afecta validez/cobertura de la receta.
- **Cobertura del paciente** (obra social/prepaga, plan, N° de afiliado):
  FHIR `Coverage`. Hoy el Dashboard no lo captura en el alta del paciente;
  el portal de recepción podría ser la fuente (hilo PORTAL-INTEGRATION).
- **Orden vs Receta** como dos salidas hermanas del mismo flujo (nosotros ya
  las tenemos unificadas por el gate de emisión — acá es solo UX).

## 5. Lo implementado en la v1

- **Sección "Prescripciones"** en la navegación (título propio, link
  "Recetas", ruta `/prescripciones`): se entra a un espacio nuevo, no a una
  pestaña del chart.
- **Selector de paciente** al estilo de las referencias: un buscador que
  entiende nombre **o DNI** (si se tipean números busca por identificador),
  con lista clickeable de resultados. El alta de pacientes queda en
  Historias clínicas a propósito (una recetadora no es una mesa de entradas).
- **Contexto del paciente** al elegirlo: nombre, DNI, CUIL, edad, sexo y
  **cobertura** leída de FHIR `Coverage` (badge "Sin cobertura registrada"
  si no hay; error visible si la lectura falla, nunca disfrazado de vacío).
- **Emisión**: el mismo `RecetasPanel` del chart — gate local + REFEPS,
  SNOMED del catálogo, historial de recetas del paciente e impresión. Un
  solo camino de escritura con dos puertas.
- **Impresión**: cantidad en números y letras ("2 (dos)", como el PDF de
  RCTA) y la cobertura conocida viaja al documento.
- **Sello de integridad + firma** (`receta-emision.ts`): cada emisión sella
  la receta (SHA-256 del contenido clínico) y deja Provenance de autoría en
  la misma transacción. La impresión deriva el estado real y declara SOLO lo
  que puede probar: con sello y firma verificados, la leyenda sube a
  "Firmada por el profesional y sellada contra modificaciones"; sin eso (o
  si la verificación falla), imprime como documento de trabajo — conservador
  y veraz. 'Legalmente emitida' queda reservado al CUIR del registro
  nacional, nunca antes.

## 6. Backlog (el orden importa)

1. **Buscador por marca comercial** (el `+` de Medicamentos): extraer del
   RF2 ya descargado los fármacos de uso clínico comerciales del DNM
   (marca ↔ genérico) para los DCI del catálogo → autocomplete de dos
   columnas Principio Activo | Marca. Es Fase 2 del plan SNOMED aplicada a
   esta pantalla. **Herramienta lista**: `npm run snomed-marcas -- --rf2
   <dir>` (reporte) y `--aplicar` (escribe `data/recetas/marcas.json`); las
   combinaciones se excluyen a propósito. Falta: correrla en el servidor,
   revisar el resultado y cablear el autocomplete.
2. **Diagnóstico CIE-10**: pasar el campo diagnóstico de texto libre a
   autocomplete codificado (RCTA lo trae obligatorio codificado).
3. **Cobertura editable**: alta/edición de `Coverage` desde el contexto del
   paciente (hoy solo se lee; la fuente natural es el portal de recepción).
4. **Tratamiento prolongado** + fechas múltiples (serie de recetas
   posdatadas en un acto) y **ocultar datos del paciente**.
5. **Leyenda registral**: cuando salga la inscripción en el Registro de
   Recetarios Electrónicos, el número RL va a `registryLegend` (el hook ya
   existe en `receta-print`).
6. **Firma Digital Remota** sobre el PDF (trámite del 18/08).

## 7. Preguntas abiertas

1. **Convivencia con Recetario/RCTA**: la práctica tiene 6.109 pacientes y
   años de historial en Recetario. ¿El módulo convive, reemplaza
   gradualmente, o importa? Si Recetario exporta, es una fuente candidata
   para sembrado histórico (mismo criterio de procedencia que se definió
   para las sesiones).
2. **Verificación pública** de la receta (RCTA usa `verumrp.com.ar/<hash>`):
   ¿publicamos un verificador propio? Toca infraestructura y privacidad —
   decisión aparte.

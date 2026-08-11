# Módulo Prescripciones: requerimientos y referencias de UX

> **Estado: recolección de requerimientos — NO diseñar ni codificar todavía.**
> Falta la segunda referencia (rcta.me). Este documento guarda lo relevado
> hasta ahora para que el diseño se haga con todo el material a la vista.

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

## 5. Preguntas abiertas (para cuando se diseñe)

1. **Referencia B pendiente**: rcta.me — el usuario va a mandar capturas.
   No cerrar ningún diseño hasta tenerlas.
2. **Convivencia con Recetario**: la práctica tiene 6.109 pacientes y años de
   historial ahí. ¿El módulo nuevo convive, reemplaza gradualmente, o
   importa? Si Recetario exporta, es una fuente candidata para sembrado
   histórico (mismo criterio de procedencia que se definió para las
   sesiones).
3. **Alcance del selector de pacientes**: ¿reusa la búsqueda de Historias
   clínicas o tiene buscador propio con alta rápida (como el paso 1 de
   Recetario)?
4. **Firma**: el flujo desemboca en el PDF con Firma Digital Remota
   (trámite del 18/08) — el diseño del paso final debe dejarle lugar.

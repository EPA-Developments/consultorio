# Recetario Fase 2 — Informe para asesoramiento legal

> **Destinatario:** abogado/a con especialidad en derecho sanitario y/o protección de datos.
> **Consultante:** BioWellness (San Isidro, Provincia de Buenos Aires).
> **Objeto:** emitir órdenes de estudios de laboratorio con validez legal desde nuestra
> plataforma propia, e inscribirla en el ReNaPDiS.
> **Fecha del relevamiento:** julio de 2026.

---

## ⚠️ Advertencia sobre la fuente de este informe

Este documento fue elaborado por el equipo técnico a partir de **búsquedas web y fuentes
secundarias** (portales de colegios profesionales, estudios jurídicos, prensa especializada).
**No se pudieron leer los textos oficiales completos**: los sitios `argentina.gob.ar`,
`boletinoficial.gob.ar`, `infoleg.gob.ar` y `hl7.org.ar` devolvieron error de acceso (HTTP 403)
durante el relevamiento.

**Por lo tanto: todo lo que sigue debe ser verificado contra las fuentes oficiales antes de
tomar cualquier decisión.** Este informe sirve para **enmarcar la consulta**, no para
reemplazarla.

---

## 1. Situación actual de BioWellness

- Operamos una plataforma clínica propia (**BioWellness · Seguimiento**), construida sobre
  **Medplum** (EHR open source, estándar **HL7 FHIR R4**), en **self-hosting** bajo nuestro
  control (`api.medplum.com.ar`).
- Ya está construido y en uso un **circuito interno de órdenes de laboratorio** ("recetario"):
  el médico selecciona estudios de un panel de 50 biomarcadores y el sistema genera las
  órdenes como recursos FHIR `ServiceRequest`, agrupadas por un número de orden común.
  El paciente también puede solicitarlas desde el portal y el médico las aprueba.
- Hoy ese circuito emite un **documento de trabajo imprimible (PDF)**, que lleva impresa la
  leyenda de que **no tiene validez legal** y que la firma/emisión corresponde a una etapa
  posterior. **No** estamos emitiendo recetas/órdenes electrónicas legalmente válidas.
- La práctica es **medicina funcional / longevidad**, con pacientes de **cobertura privada**
  (OSDE, Swiss Medical, OMINT, Medicus) y particulares. **No** operamos con obras sociales
  ni PAMI.

### Punto de atención inmediato

Según lo relevado, la **Resolución 2214/2025** (publicada el 18/07/2025) extendió la
obligatoriedad de la receta electrónica a **estudios, prácticas y procedimientos**, con un
plazo de adecuación de **120 días** (vencido aproximadamente en **noviembre de 2025**).

**A la fecha de este informe llevaríamos alrededor de 8 meses fuera del plazo de adecuación.**
Esta es la primera cuestión sobre la que necesitamos su opinión (ver § 4).

---

## 2. Marco normativo relevado (a verificar)

| Norma                          | Contenido relevado                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ley 27.553**                 | Recetas electrónicas o digitales. Marco general.                                                                                                                                               |
| **Decreto 98/2023**            | Reglamentación. Su **anexo, art. 4** fija los requisitos que deben cumplir las plataformas.                                                                                                    |
| **Resolución 1959/2024**       | Crea el **ReNaPDiS** (Registro Nacional de Plataformas Digitales Sanitarias).                                                                                                                  |
| **Disposición 1/2024** (DNSIS) | Operativiza el registro; crea el **Registro de Recetarios Electrónicos** dentro del ReNaPDiS.                                                                                                  |
| **Decreto 345/2024**           | Mencionado como parte del cambio de papel a plataformas digitales (vigencia 01/07/2024).                                                                                                       |
| **Resolución 2214/2025**       | **Extiende la obligatoriedad a estudios, prácticas y procedimientos.** Plazo de adecuación: 120 días. Excepción para zonas de baja conectividad. Resguardo de la receta por **mínimo 3 años**. |
| **Resolución 638/2026**        | (05/06/2026) Dispensa en **farmacias**: validación digital, token. **Entendemos que no aplica a órdenes de laboratorio**, pero pedimos confirmación.                                           |

### Requisitos técnicos relevados (Decreto 98/23, anexo art. 4)

Según las fuentes consultadas, las plataformas deben asegurar:

1. **Seguridad, integridad e inmutabilidad** de los datos.
2. **Interoperabilidad** con otros sistemas de salud.
3. **Confidencialidad** de la información médica.
4. **Cifrado** y tecnología segura.
5. Que cualquier uso de **inteligencia artificial** sea **de apoyo únicamente**, bajo
   supervisión profesional.

_(Necesitamos el listado textual y completo del artículo — no pudimos acceder al texto oficial.)_

### Otros elementos relevados

- **Inscripción vía TAD** (Trámites a Distancia): datos de la organización, **referente
  técnico**, datos de la aplicación, **declaración jurada** y documentación respaldatoria.
- **CUIR**: Código Único de Identificación de Receta, identificador nacional por receta.
- **Repositorios**: deben exponer **APIs públicas** con documentación técnica.
- **RDIar** (Receta Digital Interoperable Argentina): guía de implementación **HL7 FHIR**
  para la receta digital argentina. Relevante porque nuestra plataforma **ya usa FHIR R4**.
- **Precedente**: existen plataformas tipo EHR inscriptas (p. ej. una identificada como
  ReNaPDiS #248), lo que sugiere que un sistema como el nuestro **puede** inscribirse.

---

## 3. Decisión tomada (sujeta a su opinión)

Evaluamos dos caminos:

- **Camino A — Inscribir nuestra propia plataforma en el ReNaPDiS.**
  Autonomía total, sin costo por receta, control del dato. A cambio: trámite, cumplimiento
  del art. 4 del anexo del Decreto 98/23 y **responsabilidad regulatoria propia**.
- **Camino B — Integrar por API una plataforma ya inscripta.**
  Cumplimiento inmediato, menor carga regulatoria; costo por receta/abono y dependencia
  de un tercero.

**Decisión preliminar de la dirección: Camino A.** Este informe busca validar esa decisión y
dimensionar sus obligaciones.

---

## 4. Consultas concretas

### 4.1 Sobre la situación de incumplimiento

1. ¿Confirma que la **Res. 2214/2025** alcanza a las **órdenes de estudios de laboratorio**
   emitidas por un médico en una práctica privada como la nuestra?
2. Estando **fuera del plazo de adecuación**, ¿qué **exposición** concreta existe
   (sanciones, responsabilidad profesional del médico firmante, rechazo por parte de
   laboratorios o financiadores)? ¿Quién es el sujeto obligado: el **profesional**, el
   **establecimiento**, o ambos?
3. **¿Qué hacemos mientras dura el trámite de inscripción?** ¿Es admisible seguir emitiendo
   órdenes en papel firmadas de puño y letra durante la transición? ¿Conviene, como puente,
   contratar temporalmente una plataforma inscripta (Camino B) hasta completar el Camino A?

### 4.2 Sobre la inscripción (Camino A)

4. ¿Cuál es el **texto vigente y completo** del art. 4 del anexo del Decreto 98/23, y qué
   otros requisitos incorporaron la Disposición 1/2024 y normas posteriores?
5. ¿Qué figura debe inscribirse: la **persona jurídica** (razón social) o el
   **establecimiento**? ¿Qué implica ser **"referente técnico"** en términos de
   responsabilidad personal?
6. ¿Existe algún requisito de **habilitación sanitaria del establecimiento** como condición
   previa a la inscripción?
7. ¿Hay **costo/arancel** y **plazos** estimados del trámite? ¿La inscripción **vence** o
   requiere renovación/reinscripción periódica?

### 4.3 Sobre la firma

8. **¿Firma electrónica o firma digital?** ¿La norma exige **firma digital** en los términos
   de la **Ley 25.506** (con certificado de una Autoridad Certificante licenciada), o admite
   **firma electrónica** con mecanismos propios de autenticación e inmutabilidad?
   _Esta respuesta define nuestra arquitectura técnica, por eso es la consulta más importante._
9. Si se exige firma digital: ¿qué **Autoridad Certificante** recomienda y qué requiere cada
   médico para obtener su certificado?
10. ¿Cómo debe acreditarse la **matrícula** del profesional en la orden emitida (matrícula
    nacional/provincial, validación contra **REFEPS**)? Varios de nuestros profesionales
    tienen matrícula de la **Provincia de Buenos Aires**.

### 4.4 Jurisdicción

11. **Provincia de Buenos Aires**: ¿existen requisitos **provinciales** adicionales
    (Ministerio de Salud PBA, Colegio de Médicos distrital) para emitir órdenes electrónicas,
    por encima del régimen nacional?
12. Nuestros pacientes pueden atenderse y realizarse los estudios en **CABA**. ¿Genera algún
    requisito adicional la emisión interjurisdiccional?

### 4.5 Datos personales y conservación

13. La norma exige resguardo por **mínimo 3 años**. ¿Corre desde la emisión? ¿Convive con
    plazos más largos de la **historia clínica** (Ley 26.529, 10 años)? ¿Cuál prevalece?
14. Somos **self-hosted**. ¿Hay exigencia de que los datos estén **alojados en territorio
    argentino**? ¿Qué obligaciones nos impone la **Ley 25.326** de protección de datos
    (registro de bases de datos, datos sensibles de salud) en este contexto?
15. ¿Qué debe decir el **consentimiento del paciente** respecto del tratamiento digital de
    sus órdenes? _(Nota: el consentimiento se gestiona en otro sistema nuestro —
    `recepcion.biowellness.ar` —; nos interesa saber si debe contemplar este punto.)_

### 4.6 Responsabilidad e IA

16. Nuestra plataforma usa **IA como apoyo** (borradores de planes de cuidado que el médico
    aprueba). Entendemos que esto es compatible con el requisito de "IA de apoyo bajo
    supervisión profesional". ¿Comparte el criterio? ¿Debe declararse en la DDJJ de
    inscripción?
17. ¿Qué responsabilidad asume la plataforma (y su referente técnico) frente a una orden mal
    emitida, adulterada o no disponible por caída del sistema?

---

## 5. Qué necesitamos como resultado

1. **Confirmación o corrección** del marco normativo de § 2.
2. **Recomendación** sobre Camino A vs. Camino B, y sobre la **transición** (§ 4.1.3).
3. **Definición sobre la firma** (§ 4.3.8) — es bloqueante para el desarrollo.
4. **Checklist de requisitos** a cumplir y **documentación** a presentar en el TAD.
5. **Confirmación de la situación PBA** (§ 4.4).

---

## Anexo — Capacidades técnicas ya existentes

Para dimensionar el esfuerzo de cumplimiento, esto es lo que la plataforma **ya tiene**:

- **Estándar HL7 FHIR R4** nativo (facilita el requisito de interoperabilidad y el
  alineamiento con la guía RDIar).
- **Órdenes modeladas como `ServiceRequest`** con códigos **LOINC**, agrupadas por número de
  orden (requisición), con profesional solicitante y su matrícula.
- **Trazabilidad**: el servidor versiona cada recurso y conserva su historial de cambios
  (base para el requisito de integridad/inmutabilidad).
- **Control de acceso por roles** (AccessPolicies) y cifrado en tránsito (HTTPS).
- **Infraestructura propia** (self-hosted), con control sobre el almacenamiento y el respaldo.

Lo que **falta construir** depende de su respuesta sobre la firma (§ 4.3.8): firma del
profesional sobre la orden, sellado de inmutabilidad, CUIR, verificación por QR y política de
retención de 3 años.

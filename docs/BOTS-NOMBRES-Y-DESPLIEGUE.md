# Bots: nombres, proyecto y despliegue

## El problema que resuelve este documento

`api.medplum.com.ar` hospeda varios consultorios como proyectos distintos, y
esos proyectos se ven entre sí: **Favaloro → Super Admin → Biowellness**, por
`Project.link`, y los links encadenan. En Medplum eso significa que una búsqueda
lanzada desde Favaloro **devuelve también los recursos de los proyectos
linkeados**, sin ninguna señal de que el recurso es ajeno.

Los bots se resuelven por nombre. Con los nombres genéricos del template
(`ckm-recalculate`, `careplan-generate`, …), `Bot?name=careplan-generate` desde
Favaloro podía devolver el bot de Biowellness. Eso ya rompió una vez en el
camino de escritura: el deploy resolvió cuatro de cinco bots a los de otros
proyectos y **les pisó el código ejecutable**, reportando "Bot existente" con
ids ajenos y sin un solo error (commit `e900d18`).

En el camino de lectura el daño es distinto y peor: ejecutar el bot de otro
consultorio **con un paciente nuestro**.

## Las dos defensas

1. **Nombre único por proyecto.** Todo bot de este repo se llama
   `favaloro-<módulo>-<bot>`. Un nombre que no existe en el proyecto del vecino
   no puede colisionar. La tabla está en [`src/bot-names.ts`](../src/bot-names.ts)
   y es la única fuente: el bundle de despliegue, el FrontEnd y los scripts de
   verificación leen de ahí.

   | Fuente | Nombre en el servidor |
   |---|---|
   | `src/bots/ckm/ckm-recalculate.ts` | `favaloro-ckm-recalculate` |
   | `src/bots/ckm/sdoh-response.ts` | `favaloro-ckm-sdoh-response` |
   | `src/bots/ckm/ckm-alerts.ts` | `favaloro-ckm-alerts` |
   | `src/bots/ckm/careplan-generate.ts` | `favaloro-ckm-careplan-generate` |
   | `src/bots/refeps/refeps-verify.ts` | `favaloro-refeps-verify` |

2. **Filtro por `meta.project`.** [`src/bot-lookup.ts`](../src/bot-lookup.ts)
   descarta los candidatos que constan de otro proyecto. Tiene dos modos porque
   los dos caminos no toleran lo mismo:

   - `estricto` (deploy): si no puede saber de qué proyecto es un candidato,
     **aborta**. Escribir sobre el bot de otro es peor que no desplegar.
   - `tolerante` (FrontEnd y diagnósticos): el navegador no recibe
     `meta.project` salvo en *extended mode*, así que exigirlo dejaría al panel
     sin encontrar nunca su propio bot. Ahí la defensa es el nombre único.

Además, `src/scripts/lib/proyecto.ts` corta **por defecto** cualquier script de
bots que se conecte a un proyecto que no sea Favaloro
(`78ead38c-0f59-4576-b196-71685537588c`). Para un segundo despliegue del repo en
otro proyecto: `MEDPLUM_EXPECTED_PROJECT=<id>`.

## Migrar los bots ya desplegados

Cambiar el nombre en el repo **no renombra nada en el servidor**. Si se despliega
sin migrar, `deploy-bots-server` no encuentra `favaloro-ckm-recalculate`, crea un
Bot nuevo, y el viejo queda vivo con su Subscription: **dos Subscriptions sobre
el mismo criteria**, o sea cada laboratorio recalculando el estadío dos veces y
alertas duplicadas al médico de cabecera.

Por eso se renombra **en el lugar** (conserva el id del Bot, su Lambda, su
`ProjectMembership` y sus Subscriptions), y recién después se despliega:

```bash
# 1. Ver el inventario y el plan. No escribe nada.
MEDPLUM_CLIENT_ID=... MEDPLUM_CLIENT_SECRET=... npm run rename-bots

# 2. Aplicarlo.
MEDPLUM_CLIENT_ID=... MEDPLUM_CLIENT_SECRET=... npm run rename-bots -- --apply

# 3. Recién ahora, desplegar.
npm run build:bots
MEDPLUM_CLIENT_ID=... MEDPLUM_CLIENT_SECRET=... npm run deploy-bots-server

# 4. Verificar: los bots con el nombre nuevo y UNA sola Subscription por bot.
MEDPLUM_CLIENT_ID=... MEDPLUM_CLIENT_SECRET=... npm run ckm-bots-doctor
```

`rename-bots` es idempotente y se planta ante lo dudoso:

- Un bot que ya tiene el nombre nuevo no se toca.
- Un bot que no existe en el proyecto lo crea el deploy; no se inventa nada.
- Si existen **los dos** (el viejo y el nuevo) lo reporta como conflicto y no
  toca ninguno: hay que decidir a mano cuál sobrevive y borrar el otro con sus
  Subscriptions.
- Los bots del proyecto que este repo no despliega (por ejemplo los
  `*-encounter-note` del template original) se listan aparte y no se tocan.

También actualiza `Subscription.reason`, que guarda el nombre del bot y es por
donde filtran `verify-prevent` y `ckm-bots-doctor`. Las Subscriptions se
localizan por `channel.endpoint` (`Bot/<id>`), que es lo único que el renombre
no cambia.

## Los dos comandos de despliegue no son el mismo

- `npm run build:bots` **no toca ningún servidor**: compila los bots y escribe
  el bundle local `data/core/example-bots.json` (artefacto de build, no
  versionado). No necesita credenciales.
- `npm run deploy-bots-server` es el que escribe en `api.medplum.com.ar`, con
  `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` de un ClientApplication **admin
  del proyecto**.

El `MEDPLUM_CLIENT_SECRET` no va nunca en `.env`: Vite expone al bundle del
navegador todas las variables con prefijo `MEDPLUM_` (ver `vite.config.ts`).
Para los scripts, pasalo inline en la línea de comandos.

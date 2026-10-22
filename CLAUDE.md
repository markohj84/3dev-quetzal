# Instrucciones para Claude Code

Este repositorio es una base de asistentes conversacionales vendible a
clientes. Una instancia por cliente, un núcleo compartido.

## La invariante

**Ningún archivo bajo `core/` puede nombrar a un cliente.** Ni "3dev", ni
"Quetzal", ni Las Cholulas, ni Marco.

Verificado con `npm run check:boundary`. Corre ese comando antes de dar
cualquier tarea por terminada. Si falla, la solución nunca es relajar el
check — es mover el código al lugar correcto.

## Dónde va cada cosa

Antes de escribir código nuevo, decide de qué lado cae:

- **Conducta que cambia entre clientes** → `clients/<id>/voice.md` o
  `assistant.config.ts`. Si no se puede expresar ahí, amplía el esquema en
  `core/config/schema.ts`. Nunca lo resuelvas con un condicional.
- **Mecánica que es igual para todos** → `core/`.
- **Particularidad de un canal** (ventana de 24h de WhatsApp, longitud
  máxima, dialecto de formato) → el adaptador de ese canal, nunca el motor.

El motor no debe poder averiguar por qué canal llegó un mensaje.

## Clientes

Un deploy por cliente: mismo repositorio, un proyecto de Vercel por cliente,
y la variable `CLIENT` (default `3dev`) elige la carpeta `clients/<cliente>/`
(`app/assistant.ts`). Todo lo del cliente vive en su carpeta: config, voz,
conocimiento, `widget.html`, `privacidad.tsx` y `evals.ts`.
`next.config.js` incluye `clients/` en el paquete porque la ruta se decide en
tiempo de ejecución. Para dar de alta uno nuevo: copiar `clients/_plantilla/`
y seguir `docs/nuevo-cliente.md`; `scripts/client-check.ts` revisa que esté
listo (y crea sus plantillas de Meta). Los evals que todo cliente debe pasar
viven en `scripts/evals.ts` (`genericCases`); cada `clients/<cliente>/evals.ts`
agrega los suyos. Las configs importan `schema.ts` con extensión para que
Node las ejecute directo en scripts y evals.

### Multi-tenant (un deploy, muchos clientes)

Con `MULTI_TENANT=1` un solo proyecto de Vercel atiende todas las carpetas de
`clients/` (menos las que empiezan con `_`). **Sin esa variable nada cambia**:
un cliente por proyecto, `CLIENT`, variables sin prefijo. Cada petición se
resuelve por su dominio (`x-forwarded-host`: chat, widget, inicio, privacidad,
panel, Calendly) o, en el webhook de WhatsApp, por el `phone_number_id`; un
host o un número que no es de nadie responde 404 (webhook: 200 sin hacer
nada), nunca cae en otro cliente. Los dominios van en `domains` de
`assistant.config.ts`; dos clientes no pueden reclamar el mismo dominio ni el
mismo número (el registro lo rechaza al arrancar). Los secretos del cliente van
con prefijo —`QUETZAL_3DEV__CALCOM_API_KEY` (id en mayúsculas, no alfanumérico
→ `_`)— y **en este modo no tienen respaldo sin prefijo**: si falta la llave de
Cal.com de un cliente, ese cliente no agenda, nunca usa la de otro. Son de la
plataforma (con respaldo) `ANTHROPIC_API_KEY`, `CRON_SECRET`, Redis, Supabase,
`WHATSAPP_APP_SECRET` y `WHATSAPP_VERIFY_TOKEN` (la app de Meta es de 3dev).
`core/config/env.ts` (`clientEnv`) y `core/tenants.ts` son genéricos; `core/`
no lee variables de un cliente: las credenciales llegan como argumentos
(`sendTemplate(msg, creds)`, `createLeadNotifier(config, secrets)`). La sesión
de Redis lleva el cliente: `session:<clientId>:<contactId>`. El cron de
seguimiento recorre todos los clientes. Prueba: `scripts/check-tenants.mjs`
contra un dev server con `MULTI_TENANT=1` (ver el encabezado del script).

## Reglas de producto que no se negocian

1. **El asistente no inventa datos.** Ninguna cifra, duración, nombre o
   resultado que no esté en `clients/<id>/knowledge/`. Si falta, responde
   que no lo tiene y ofrece la conversación con el humano.
2. **La oferta de agendar es una sola vez por conversación.** Se aplica con
   estado (`hasOffered`), no pidiéndoselo al modelo.
3. **`voice.md` se inserta literal en el prompt.** Nunca lo parafrasees,
   resumas ni reescribas desde código.
4. **Los documentos crudos del cliente no entran al conocimiento.**
   Contienen precios internos y criterios de calificación que no pueden
   salir por boca del asistente. El conocimiento se cura a mano.

## De dónde sale la oferta de 3dev

La estrategia y el catálogo de precios **no viven aquí**. Su fuente es el
repositorio del sitio (`markohj84/3dev`):
`docs/strategy/estrategia-marca-v2.md` (el porqué) y
`docs/strategy/oferta.json` (nombres y precios, canónico). Este repo guarda
una copia exacta en `clients/3dev/offer.lock.json`.

- `npm run check:offer` (corre también en `prebuild`) falla si un nombre o
  precio activo del lock no aparece en `clients/3dev/knowledge/` o
  `voice.md`.
- `npm run check:offer -- --remote` además compara el lock con el canónico
  publicado; si difiere, sigue `docs/strategy/propagacion.md` de ese repo:
  copia el canónico, actualiza el conocimiento a mano, ajusta `voice.md`
  si cambió la prioridad comercial, y corre `npm run eval:3dev`.

El lock nunca entra al prompt (el corpus solo carga `.md`), y la regla 4 de
arriba sigue en pie: el conocimiento se escribe a mano, no se genera del
catálogo.

## Stack

Next.js 15 (App Router), TypeScript, SDK de Anthropic, Zod, Vercel.
El sitio de 3dev es un repositorio aparte y solo consume el widget por embed.

## Evals de voz y conocimiento

`clients/3dev/evals.ts` corre casos de humo contra `/api/chat` real (no
inventa datos, una sola oferta de agendar, enrutamiento correcto a cada
oferta, nunca nombra al equipo, no promete memoria persistente, captura de
lead). Correr con `npm run dev` en una terminal y `npm run eval:3dev` en
otra, después de cualquier cambio a `voice.md`, `knowledge/`,
`assistant.config.ts` o al tool-calling del motor. Usa Anthropic real
(cuesta unos centavos), necesita `KV_REST_API_URL`/`TOKEN` en el entorno
(las carga `--env-file=.env.local`), y limpia sus propias sesiones y leads
de prueba (prefijo `eval-`) al terminar. La limpieza borra también sus
contactos y mensajes de Postgres; el reporte excluye `eval-*` de todos modos.

Los casos marcados `channel: 'whatsapp'` pasan por `/api/whatsapp` real:
firman el payload con `WHATSAPP_APP_SECRET` y leen la respuesta de la
sesión. En local sirve cualquier valor, siempre que el dev server y el eval
vean el mismo (ponerlo en `.env.local`); sin él, esos casos se saltan con
aviso. `deliver()` sí le pega a Meta, pero el contacto de prueba no tiene
dígitos y Meta lo rechaza (`131009`): no sale ningún mensaje.

## Tool-calling

`core/engine/conversation.ts` corre un loop de tool-calling (tope
`MAX_TOOL_ROUNDS`) alrededor de cada `respond()` — el ir y venir con el
modelo queda dentro de esa llamada, no se persiste en `ConversationState`.
El único tool hoy es `capture_lead` (`core/tools.ts`): el modelo lo llama
en cuanto alguien comparte nombre y contacto, sin importar el motivo.
`respond()` regresa `capturedLead` cuando eso pasa; las rutas lo guardan
sin vencimiento en `leads` (`createLeadStore`,
`core/store/db.ts`) y disparan `core/notify.ts` con los datos
estructurados. Nuevos tools van en `core/tools.ts` si son genéricos —
un tool con lógica específica de un cliente no debe vivir en `core/`.

`check_availability` consulta horarios reales del calendario (solo si hay
llave). `book_meeting` agenda la cita dentro del chat: solo existe si el
scheduler implementa `book()` — hoy Cal.com (`core/scheduling/calcom.ts`);
la API de Calendly no puede crear citas. Recibe día, mes y hora en la zona
del negocio, nunca un ISO, y el scheduler vuelve a consultar los horarios
libres antes de reservar. El modelo solo puede decir "quedó agendada" si el
tool lo confirmó; el eval de agenda lo verifica contra Cal.com y cancela la
cita al terminar. Corre solo con `EVAL_BOOKING=1`: cada corrida le manda
a Marco dos correos de Cal.com (cita creada y cancelada). Cal.com exige correo o teléfono (en 3dev el teléfono es
obligatorio): en WhatsApp sale solo del remitente (`KnownContact.phone`).
`remember_contact` guarda nombre e interés en la ficha de contacto (ver
abajo) y solo se ofrece en canales con `stableContactId: true`; va antes de
los tools de agenda en la lista, porque detrás de `book_meeting` el modelo
dejaba de llamarlo.

`lookup_catalog` (`core/catalog.ts`) lee una Google Sheet publicada como CSV
— promociones, productos, existencias: lo que cambia demasiado para
`knowledge/`. Solo existe si la config trae `catalog`; `catalog.description`
entra a la descripción del tool, y es lo que hace que el modelo lo llame.
Regresa la hoja completa (tope `maxRows`) con la fecha de hoy, para que
una vigencia vencida se note, y marca `(agotado)` un 0 en una columna de
existencias: con la regla solo en el prompt, el modelo seguía ofreciendo el
agotado como alternativa. Caché de 5 min por instancia; si Google falla,
sirve la última copia buena (hasta 1 h), y sin copia el modelo dice que no
lo puede confirmar. Solo datos públicos: la hoja publicada la lee cualquiera.

## Ficha de contacto

La sesión sigue muriendo a las 24h. Lo que sobrevive es una ficha corta por
contacto en `contacts` (`createProfileStore`, `core/store/db.ts`): nombre,
interés, si ya dejó datos y `lastSeenAt`, con 90 días de vida desde el último
mensaje (`purge_expired()` la vacía). Solo existe en canales cuyo `contactId` es estable entre
conversaciones (`ChannelCapabilities.stableContactId`): WhatsApp sí, la web
no (el widget estrena id por carga de página). La ruta de WhatsApp la lee
antes de `respond()` y la escribe con lo que regresó `remembered` o
`capturedLead`. El nombre de perfil de WhatsApp (`displayName`) entra solo
como pista, nunca se guarda. La ficha va en un segundo bloque de sistema,
después del breakpoint de caché, para no romper el caché compartido.


Además, en WhatsApp la ruta carga hasta 30 mensajes de los últimos 90 días
anteriores a la conversación actual (`ConversationLog.earlier`, separados por
`ConversationState.startedAt`) y los pasa en la nota de contacto como
"Earlier conversations": son los mensajes reales, no un resumen, y el
asistente puede decir que los recuerda. La web no recuerda.
## Notificación de leads

Se dispara en dos momentos distintos, que pueden no coincidir: (1) cuando
`hasOffered` pasa de `false` a `true` (alguien mostró interés real, aunque
no haya dejado contacto) y (2) cuando el modelo llama `capture_lead` (ver
"Tool-calling" arriba). Ambos usan `core/notify.ts` — un correo con la
transcripción vía la API de Resend. Configurado por cliente en
`assistant.config.ts` (`notify.email`, `notify.fromEmail`); sin
`RESEND_API_KEY` en el entorno, no truena — solo avisa por log y sigue
respondiendo normal. Requiere que el dominio del `fromEmail` esté verificado
en la cuenta de Resend.

El mismo aviso sale también por WhatsApp desde el número del cliente si
`notify.whatsapp.to` tiene valor (en 3dev viene de `NOTIFY_WHATSAPP_TO`,
solo en Vercel: el repo es público). Como el asistente escribe primero, va
como plantilla aprobada por Meta (`aviso_lead`, cuatro variables: tipo de
aviso, nombre, contacto, detalle). Cada canal falla por su cuenta: si Meta
rechaza el envío, el correo sale igual. No poner `NOTIFY_WHATSAPP_TO` en
`.env.local`, o cada eval que capture un lead mandará un WhatsApp real.

## Seguimiento automático

Un cron diario (`vercel.json`, 16:00 UTC = 10:00 en México) llama
`/api/cron/follow-up`, firmado por Vercel con `CRON_SECRET` (sin él, 403).
Le manda **un solo** WhatsApp a cada lead que dejó teléfono hace entre
`followUp.afterHours` y +48 h y no agendó: plantilla aprobada por Meta
(`seguimiento_lead`), porque el negocio escribe primero. La marca en
`follow_ups` (90 días) se pone **antes** de enviar — una
caída cuesta un mensaje, nunca manda dos — y también cuando alguien agenda
en el chat. El texto se escribe en la sesión para que un "sí" tenga
contexto. Los leads con contactId `eval-` se ignoran siempre. Configurado en
`assistant.config.ts` (`followUp`); sin esa sección, el cron no hace nada.
Antes de enviar, el cron le pregunta a Cal.com quién agendó desde el lead más
viejo de la ventana (`Scheduler.bookedPhones`), así que tampoco le escribe a
quien agendó por el enlace. Si Cal.com no responde, ese día no sale ningún
seguimiento (503): la ventana abarca dos corridas y el siguiente día los alcanza.

## Registro de conversaciones

Cada turno se guarda en Postgres (Supabase; `core/store/db.ts`,
`createConversationLog`): un contacto en `contacts` y dos filas en
`messages` (`user`, `assistant`), con `client_id` = el `id` de la config.
Una sola base para todos los clientes. Los plazos del aviso de privacidad
los aplica la base: `purge_expired()` corre cada noche con `pg_cron`
(mensajes y contactos 12 meses sin escribir, ficha —nombre, interés y
`left_contact`— 90 días, marcas de seguimiento 90 días). El esquema vive en `supabase/migrations/` y se aplica
con `npx supabase db push --db-url` (la conexión directa está en
`POSTGRES_URL_NON_POOLING`, en Vercel). Redis solo guarda la sesión de 24 h
y el límite de mensajes. Cada llamada a la base tiene timeout de 3 s y sin
reintentos, y las rutas tratan sus fallas como no fatales: una base caída
cuesta una línea de log, nunca la respuesta ni el aviso. Pruebas contra la base real:
`scripts/check-purge.mjs` y `scripts/check-db.mjs`.

`npm run report:3dev -- [días]` (default 7) resume el uso real: personas,
mensajes, leads, citas (de Cal.com), seguimientos. Excluye `eval-*` y los
números de `REPORT_EXCLUDE` en `.env.local` (el del dueño).


## Panel del cliente

`/panel` en el dominio de cada cliente (`app/panel/`): el dueño entra con
un código de 6 dígitos por correo (Supabase Auth, `shouldCreateUser:
false`) y ve Resumen, Conversaciones y Leads de su negocio, en solo
lectura salvo el handoff (ver abajo). Las páginas leen con la sesión del usuario (`@supabase/ssr`,
llave pública) y RLS decide qué filas ve: solo los `client_id` que tiene
en `dashboard_users`; ninguna política permite escribir. El panel nunca
usa `service_role`. `middleware.ts` solo corre en `/panel/*`. Accesos:
`node --env-file=.env.local scripts/panel-user.mjs add|remove <correo>
<clientId>` y `list <clientId>`. Los códigos salen por el SMTP de Resend
configurado en Supabase. Pruebas: `scripts/check-panel-rls.mjs` (base
real) y `scripts/check-panel-pages.mjs <clientId>` (contra el dev server,
con sesión real y sin mandar correos). Las citas del resumen y la
etiqueta "agendó" salen de Cal.com (`scheduler.bookedPhones`).


## Handoff en vivo

Solo WhatsApp. En `/panel/conversaciones/<id>` el dueño toma la
conversación, contesta (sale por el número del negocio con `deliver()`,
desde una server action) y la devuelve; si no escribe en 4 h, vuelve sola
(`core/handoff.ts`). Mientras está tomada, la ruta de WhatsApp no llama al
motor: guarda el mensaje (`appendInbound`) y lo agrega a la sesión, y le
avisa al dueño por los canales de `notify` como máximo cada 15 min. Lo que
escribe el dueño queda en `messages` con `role = 'human'` (solo si Meta
aceptó el envío) y en la sesión como turno del asistente, para que al
retomarla tenga el contexto. RLS: el dueño solo inserta mensajes `human` y
toma o devuelve en su cliente. Los avisos de lead e interés traen el enlace
al panel (`app/panel/links.ts`, `VERCEL_PROJECT_PRODUCTION_URL`). Carrera
conocida: si toma la conversación mientras el asistente ya está
contestando, esa respuesta sale una vez.


## Administración de 3dev

`/admin` (`app/admin/`): tabla con todos los clientes y su uso del periodo (7, 30
o 90 días): personas, mensajes recibidos, leads, seguimientos enviados, último
mensaje y conversaciones tomadas ahora. **Solo agregados**: no lee
conversaciones ni datos de contacto. Acceso: `platform_admins` (mismo login por
código) y la función `admin_usage(days)` (`security definer`: responde solo si
`auth.uid()` está ahí; las tablas de los clientes no ganan políticas). La lista
de clientes sale de `contacts`, no del código; se excluyen contactos `eval*`.
Alta: `node --env-file=.env.local scripts/panel-user.mjs admin add <correo>`
(`remove`, `list`). Cada lectura revisa el acceso por sí misma (`requireAdmin`):
una petición RSC puede saltarse el layout. Pruebas: `scripts/check-admin.mjs`
(base real) y `scripts/check-admin-pages.mjs` (dev server). **Costos**: cada
respuesta guarda en `usage` la suma de sus llamadas al modelo (`respond()`
regresa `usage`; las rutas lo registran con `createUsageLog`, sin bloquear la
respuesta), `admin_tokens(days)` la agrega por cliente y modelo (solo
`platform_admins`) y `app/admin/pricing.ts` la convierte a dólares: **agregar
ahí el precio de cada modelo nuevo**, o el panel muestra tokens "sin precio".
El costo existe desde el día del deploy y es solo el de Anthropic (sin
plantillas de WhatsApp, Supabase ni Vercel). Fuera de la v1: citas (viven en
Cal.com con la llave de cada cliente) y detalle por cliente.
## Hoja de ruta (visión del modelo de negocio, no estado actual)

La oferta activa de 3dev tiene dos líneas: paquetes de sitio web (Web
Esencial, Web Completa, Tienda en línea — `knowledge/sitios-web.md`) y la
escalera de IA. Los paquetes web son solo conocimiento: Quetzal los explica,
no construye sitios. La escalera de IA es Oferta 0
(automatización puntual, sin chatbot), Oferta 1 "Quetzal / Asistente"
(web + WhatsApp) y Oferta 2 "Quetzal / Flujos" (el asistente + automatización
real) — reflejada en `clients/3dev/knowledge/` y `voice.md`. Eso ya está
implementado y probado.

**Oferta 2 ("que actúe") está completa:** captura leads, agenda dentro del
chat (Cal.com), avisa por correo y WhatsApp, da seguimiento automático y
consulta un catálogo en vivo (Google Sheet). Conectar sistemas propios del
cliente (POS, expedientes, saldos) sigue siendo automatización a la medida:
no hay tool genérico, y las consultas de datos personales necesitan
verificar identidad antes de existir.

El documento de estrategia que definió esta escalera también da por hechas
otras piezas de ingeniería que **no existen todavía**. No meterlas en el
prompt del asistente hasta que estén construidas — prometer una capacidad
que no existe es peor que no tener el dato:

- **Memoria en la web**. En WhatsApp ya hay memoria de conversaciones (90
  días, ver "Ficha de contacto"); la web no recuerda. No vender más que eso.
- **Arquitectura multi-tenant por dominio** ("un deploy, muchos clientes"):
  construida y probada (ver "Multi-tenant"). Producción sigue con un proyecto
  de Vercel por cliente hasta migrar (decisión de Marco).
- **Postgres/Supabase** ya guarda conversaciones, leads, fichas y
  seguimientos (ver "Registro de conversaciones"). Falta pgvector para RAG.
- **Capa model-agnostic** para intercambiar de proveedor de IA sin reescribir.
  Hoy `core/engine/conversation.ts` llama directo al SDK de Anthropic.
- Flujos n8n reales (el panel de administración con uso y costo de modelos ya existe). La notificación
  asíncrona cuando hay un lead interesado sí está construida — ver
  "Notificación de leads" abajo.

## Estilo

Comentarios solo donde expliquen *por qué*, no *qué*. Nombres en inglés en
el código; el contenido de cara al usuario en español.

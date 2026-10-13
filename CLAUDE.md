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
de prueba (prefijo `eval-`) al terminar. Las entradas del log de
conversaciones se quedan: al medir uso real, excluir los contactIds `eval-`.

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
sin vencimiento en `leads:<clientId>` (`createLeadStore`,
`core/store/session-store.ts`) y disparan `core/notify.ts` con los datos
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

## Ficha de contacto

La sesión sigue muriendo a las 24h. Lo que sobrevive es una ficha corta por
contacto en `profile:<clientId>:<contactId>` (`createProfileStore`): nombre,
interés, si ya dejó datos y `lastSeenAt`, con 90 días de vida que se renuevan
con cada mensaje. Solo existe en canales cuyo `contactId` es estable entre
conversaciones (`ChannelCapabilities.stableContactId`): WhatsApp sí, la web
no (el widget estrena id por carga de página). La ruta de WhatsApp la lee
antes de `respond()` y la escribe con lo que regresó `remembered` o
`capturedLead`. El nombre de perfil de WhatsApp (`displayName`) entra solo
como pista, nunca se guarda. La ficha va en un segundo bloque de sistema,
después del breakpoint de caché, para no romper el caché compartido.

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
(`seguimiento_lead`), porque el negocio escribe primero. La marca
`followup:<clientId>:<número>` (90 días) se pone **antes** de enviar — una
caída cuesta un mensaje, nunca manda dos — y también cuando alguien agenda
en el chat. El texto se escribe en la sesión para que un "sí" tenga
contexto. Los leads con contactId `eval-` se ignoran siempre. Configurado en
`assistant.config.ts` (`followUp`); sin esa sección, el cron no hace nada.
Límite conocido: quien agenda por el enlace de Cal.com (no en el chat) sí
recibiría el seguimiento.

## Registro de conversaciones

Cada turno se guarda en Redis (`core/store/session-store.ts`,
`createConversationLog`), en una lista por cliente y día:
`log:<clientId>:<YYYY-MM-DD>`, con retención de 90 días. Es para revisar
conversaciones a mano, no para búsqueda ni dashboards — si eso hace falta,
mover a un datastore real en vez de seguir creciendo este esquema de keys.

`npm run report:3dev -- [días]` (default 7) resume el uso real: personas,
mensajes, leads, citas (de Cal.com), seguimientos. Excluye `eval-*` y los
números de `REPORT_EXCLUDE` en `.env.local` (el del dueño).

## Hoja de ruta (visión del modelo de negocio, no estado actual)

La oferta activa de 3dev tiene dos líneas: paquetes de sitio web (Web
Esencial, Web Completa, Tienda en línea — `knowledge/sitios-web.md`) y la
escalera de IA. Los paquetes web son solo conocimiento: Quetzal los explica,
no construye sitios. La escalera de IA es Oferta 0
(automatización puntual, sin chatbot), Oferta 1 "Quetzal / Asistente"
(web + WhatsApp) y Oferta 2 "Quetzal / Flujos" (el asistente + automatización
real) — reflejada en `clients/3dev/knowledge/` y `voice.md`. Eso ya está
implementado y probado.

**Oferta 2 ("que actúe") ya captura leads y agenda citas dentro del chat
(Cal.com).** Faltan "consulta información del negocio en vivo" y el
seguimiento automático a leads: `knowledge/ofertas.md` los declara como
"no hace" — ampliarlo solo cuando existan.

El documento de estrategia que definió esta escalera también da por hechas
otras piezas de ingeniería que **no existen todavía**. No meterlas en el
prompt del asistente hasta que estén construidas — prometer una capacidad
que no existe es peor que no tener el dato:

- **Memoria persistente completa entre sesiones**. Hay ficha de contacto
  (nombre + interés, 90 días, solo WhatsApp — ver "Ficha de contacto"), pero
  no historial ni memoria en la web. No vender más que eso.
- **Arquitectura multi-tenant por dominio** ("un deploy, muchos clientes").
  Hoy es un deploy por cliente: mismo repo, un proyecto de Vercel por
  cliente, y `CLIENT` elige la carpeta (ver "Clientes" arriba).
- **Postgres/Supabase** para conversaciones, leads y memoria (pgvector para
  RAG). Hoy solo hay Redis (sesión + el log de 90 días).
- **Capa model-agnostic** para intercambiar de proveedor de IA sin reescribir.
  Hoy `core/engine/conversation.ts` llama directo al SDK de Anthropic.
- Dashboard de cliente, panel de administración para 3dev, flujos n8n
  reales, handoff **en vivo** a un humano (transferir la charla mientras
  ocurre). La notificación asíncrona por correo cuando hay un lead
  interesado sí está construida — ver "Notificación de leads" abajo.

## Estilo

Comentarios solo donde expliquen *por qué*, no *qué*. Nombres en inglés en
el código; el contenido de cara al usuario en español.

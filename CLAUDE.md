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

## Registro de conversaciones

Cada turno se guarda en Redis (`core/store/session-store.ts`,
`createConversationLog`), en una lista por cliente y día:
`log:<clientId>:<YYYY-MM-DD>`, con retención de 90 días. Es para revisar
conversaciones a mano, no para búsqueda ni dashboards — si eso hace falta,
mover a un datastore real en vez de seguir creciendo este esquema de keys.

## Hoja de ruta (visión del modelo de negocio, no estado actual)

La oferta activa de 3dev tiene dos líneas: paquetes de sitio web (Web
Esencial, Web Completa, Tienda en línea — `knowledge/sitios-web.md`) y la
escalera de IA. Los paquetes web son solo conocimiento: Quetzal los explica,
no construye sitios. La escalera de IA es Oferta 0
(automatización puntual, sin chatbot), Oferta 1 "Quetzal / Asistente"
(web + WhatsApp) y Oferta 2 "Quetzal / Flujos" (el asistente + automatización
real) — reflejada en `clients/3dev/knowledge/` y `voice.md`. Eso ya está
implementado y probado.

**Oferta 2 ("que actúe") tiene ya la infraestructura de tool-calling
(ver "Tool-calling" arriba) y un tool real: capturar leads.** Pero eso es
apenas el primero — "agenda citas" y "consulta información del negocio en
vivo" siguen sin tool que los resuelva. No digas que Oferta 2 ya cumple su
promesa completa hasta que existan.

El documento de estrategia que definió esta escalera también da por hechas
otras piezas de ingeniería que **no existen todavía**. No meterlas en el
prompt del asistente hasta que estén construidas — prometer una capacidad
que no existe es peor que no tener el dato:

- **Memoria persistente entre sesiones** ("Quetzal recuerda quién eres días
  después"). Hoy la sesión expira a las 24h (`SESSION_TTL_SECONDS`); no hay
  perfil de contacto que sobreviva entre conversaciones.
- **Arquitectura multi-tenant por dominio** ("un deploy, muchos clientes").
  Hoy `app/assistant.ts` tiene el cliente hardcodeado (`CLIENT_DIR`) — cambiar
  de cliente es swap + redeploy, un deploy por cliente.
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

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

## Stack

Next.js 15 (App Router), TypeScript, SDK de Anthropic, Zod, Vercel.
El sitio de 3dev es un repositorio aparte y solo consume el widget por embed.

## Evals de voz y conocimiento

`clients/3dev/evals.ts` corre casos de humo contra `/api/chat` real (no
inventa datos, una sola oferta de agendar, enrutamiento correcto a cada
oferta, nunca nombra al equipo, no promete memoria persistente). Correr con
`npm run dev` en una terminal y `npm run eval:3dev` en otra, después de
cualquier cambio a `voice.md`, `knowledge/` o `assistant.config.ts`. Usa
Anthropic real (cuesta unos centavos) y dos sesiones prefijadas `eval-` que
quedan en Redis — se pueden limpiar a mano, no son datos de cliente real.

## Notificación de leads

Cuando `hasOffered` pasa de `false` a `true` en un turno (la señal de "esta
conversación llegó al punto de interés real"), `core/notify.ts` manda un
correo con la transcripción vía la API de Resend — una sola vez por
conversación, no en cada turno. Configurado por cliente en
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

El modelo de negocio vigente es una escalera de tres ofertas — Oferta 0
(automatización puntual, sin chatbot), Oferta 1 "Quetzal / Asistente"
(web + WhatsApp) y Oferta 2 "Quetzal / Flujos" (el asistente + automatización
real) — reflejada en `clients/3dev/knowledge/` y `voice.md`. Eso ya está
implementado y probado.

El documento de estrategia que definió esta escalera también da por hechas
piezas de ingeniería que **no existen todavía**. No meterlas en el prompt del
asistente hasta que estén construidas — prometer una capacidad que no existe
es peor que no tener el dato:

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

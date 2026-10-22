# Memoria entre conversaciones (WhatsApp) — diseño

Fecha: 2026-10-22 · Estado: aprobado en conversación, pendiente de revisión escrita

Pieza 4 de 8 de la plataforma (base de datos ✔ → panel ✔ → handoff ✔ →
**memoria completa** → multi-tenant → panel de 3dev → capa multi-proveedor →
flujos n8n).

## Objetivo

Que quien regresa por WhatsApp no tenga que repetir lo que ya contó: el
asistente ve lo que se habló en conversaciones anteriores y lo retoma.

**Éxito:**

- Alguien escribe días después y el asistente sabe de qué hablaron.
- Solo afirma lo que está en esas conversaciones; no inventa ni mezcla
  personas.
- La web no cambia.

## Decisiones

- **Solo WhatsApp**: el número identifica a la persona. La web estrena id por
  carga de página y una computadora compartida mostraría lo de otra persona.
- **Mensajes reales, no resúmenes**: lo que se dijo, tal cual (regla 1:
  no inventar). Sin búsqueda semántica.
- **Ventana**: hasta 30 mensajes, de los últimos 90 días, anteriores a la
  conversación actual.

## Flujo

1. `ConversationState` gana `startedAt?: string` (ISO). El motor lo fija en
   el primer turno de una conversación (historial vacío) o cuando falta en
   una sesión que ya existía; nunca lo cambia después.
2. La ruta de WhatsApp, antes de `respond()`, carga la memoria con
   `createConversationLog(clientId).earlier(contactId, before)` donde
   `before = state.startedAt ?? ahora`:
   mensajes del contacto con `at < before` y `at >= ahora − 90 días`, los 30
   más recientes, devueltos en orden cronológico.
3. La pasa al motor en `KnownContact.earlier?: EarlierMessage[]`
   (`{ role: 'user' | 'assistant' | 'human'; content: string; at: string }`).
4. Si la consulta falla: sin memoria, una línea en el log, el asistente
   contesta normal.

## Motor y prompt — `core/engine/prompt.ts`

`buildContactNote` agrega, cuando `earlier` trae mensajes, una sección
**después** de las que ya tiene (la nota va tras el breakpoint del caché):

```
# Earlier conversations with this person

What was said before this conversation, oldest first. "Team" is a person
from the business who answered in person.

[2026-10-19] Person: Me interesa una página para mi taller mecánico
[2026-10-19] Assistant: Para un taller, la Web Completa…
[2026-10-19] Team: Hola, soy del equipo…

You may pick the thread back up and say, truthfully, that you remember
what you talked about. State only what appears above; anything else you
do not know. Prices or facts said before do not override the knowledge
base: if they differ, the knowledge base is current. The one-offer rule
still applies to this conversation.
```

- Fechas en `YYYY-MM-DD` en la zona del negocio (`config.scheduling.timeZone`,
  UTC si falta).
- Cada mensaje se recorta a 600 caracteres (`…`) para acotar tokens.
- Solo en canales con `stableContactId: true` (ya es la condición para
  mandar la nota); la web nunca la recibe.

## Datos — `core/store/db.ts`

`ConversationLog.earlier(contactId, before: Date): Promise<EarlierMessage[]>`
con la llave de servicio, filtrando `client_id`, `contact_id`,
`at < before`, `at >= now() − 90 días`, `order at desc, id desc`,
`limit 30`, y luego invertido.

## Privacidad y documentación

- `clients/3dev/privacidad.tsx` y `clients/_plantilla/privacidad.tsx`: "Si
  nos escribes por WhatsApp, el asistente guarda tu nombre y el tema que te
  interesó durante 90 días…" pasa a "Si nos escribes por WhatsApp, el
  asistente recuerda tus conversaciones de los últimos 90 días para que no
  tengas que repetir lo que ya nos contaste." (Marco aprueba el texto.)
  El demo no cambia (no tiene WhatsApp).
- `CLAUDE.md`: "Ficha de contacto" (ahora también memoria de conversaciones)
  y la hoja de ruta (la memoria en WhatsApp existe; en la web no).

## Pruebas

- `node core/engine/prompt.ts`: la sección aparece con fecha y rol
  ("Person", "Assistant", "Team"); no aparece sin mensajes; un mensaje largo
  se recorta.
- `scripts/check-db.mjs`: `earlier` trae solo `at < before`, de los últimos
  90 días, máximo 30, en orden cronológico, sin mensajes de otro contacto ni
  de otro cliente.
- Evals por WhatsApp (`scripts/evals.ts`, genéricos):
  - recuerda: conversación sembrada hace 3 días ("taller mecánico") sin
    sesión en Redis; "Hola de nuevo, ¿qué habíamos platicado?" → la
    respuesta menciona el taller.
  - no inventa: sin historial, "¿Te acuerdas de lo que hablamos?" → no
    afirma ningún tema anterior.
  - el caso web "no promete memoria persistente" se queda.
- `npm run eval:3dev`, evals del demo, `npx tsc --noEmit`,
  `npm run check:boundary`, `npm run build`.

## Fuera de alcance

Memoria en la web, resúmenes, pgvector, comando "olvídame" (cubierto por la
solicitud ARCO del aviso).

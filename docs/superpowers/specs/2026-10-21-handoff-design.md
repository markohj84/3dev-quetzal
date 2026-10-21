# Handoff en vivo — diseño

Fecha: 2026-10-21 · Estado: aprobado en conversación, pendiente de revisión escrita

Pieza 3 de 8 de la plataforma (base de datos ✔ → panel del cliente ✔ →
**handoff en vivo** → memoria completa → multi-tenant → panel de 3dev → capa
multi-proveedor → flujos n8n).

## Objetivo

Desde el panel, el dueño toma una conversación de WhatsApp, contesta él y el
asistente se calla en esa conversación; luego la devuelve (o vuelve sola).

**Éxito:**

- El dueño contesta desde el panel y la persona lo recibe en su mismo chat de
  WhatsApp, desde el número del negocio.
- Mientras está tomada, el asistente no responde ahí; cada mensaje nuevo de la
  persona le llega al dueño como aviso (con tope).
- Si el dueño no escribe en 4 h, el asistente la retoma con todo el contexto.
- Todo queda en la transcripción, con lo del dueño marcado como "Tú".
- El panel sigue sin usar `service_role`; la base limita qué puede escribir.

## Decisiones

- **Solo WhatsApp** en la v1. El widget web es pregunta-respuesta y su sesión
  muere con la pestaña.
- **Aviso**: los avisos de lead e interés que ya existen traen el enlace a la
  conversación en el panel; en el panel hay un botón "Tomar" en toda
  conversación de WhatsApp. Sin tool nuevo en el asistente.
- **Vuelve sola a las 4 h** sin mensajes del dueño; también hay botón
  "Devolver al asistente".
- **En vivo por consulta cada 5 s** (`router.refresh()`) mientras la
  conversación está tomada y abierta. Sin Supabase Realtime.

## Base de datos — `supabase/migrations/20261022000000_handoff.sql`

```sql
alter table messages drop constraint messages_role_check;
alter table messages add constraint messages_role_check
  check (role in ('user', 'assistant', 'human'));

create table handoffs (
  client_id     text not null,
  contact_id    text not null,
  taken_by      uuid not null references auth.users on delete cascade,
  taken_by_email text not null,   -- la sesión de otro usuario no puede leer auth.users
  taken_at      timestamptz not null default now(),
  last_human_at timestamptz not null default now(),
  notified_at   timestamptz,
  primary key (client_id, contact_id),
  foreign key (client_id, contact_id) references contacts on delete cascade
);
alter table handoffs enable row level security;

create policy "panel maneja sus tomas" on handoffs for all to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())))
  with check (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));

create policy "panel escribe como humano" on messages for insert to authenticated
  with check (
    role = 'human'
    and client_id in (select client_id from dashboard_users where user_id = (select auth.uid()))
  );
```

- El dueño solo puede insertar mensajes `human` de su cliente; nunca
  `user` ni `assistant`, nunca de otro cliente. No puede editar ni borrar
  mensajes.
- `purge_expired()` no cambia: los mensajes `human` se borran a los 12 meses
  como los demás; la fila de `handoffs` cae en cascada si se borra el contacto.

## Reglas — `core/handoff.ts`

Genérico (igual para todos los clientes), con autoprueba:

- `HANDOFF_HOURS = 4`, `NOTIFY_EVERY_MINUTES = 15`, `WINDOW_HOURS = 24`.
- `isTaken(handoff | null, now): boolean` — existe y `last_human_at` tiene
  menos de 4 h.
- `returnsAt(handoff): Date` — `last_human_at + 4 h`.
- `shouldNotify(handoff, now): boolean` — `notified_at` nulo o de hace más de
  15 min.
- `windowOpen(lastUserAt | null, now): boolean` — el último mensaje de la
  persona tiene menos de 24 h.

`core/store/db.ts` gana un `createHandoffStore(clientId)` (con
`service_role`, para la ruta): `get(contactId)`, `release(contactId)`,
`markNotified(contactId)`. Y `ConversationLog` gana `appendInbound(entry)`:
guarda solo el mensaje de la persona (sin respuesta del asistente).

## Ruta de WhatsApp — `app/api/whatsapp/route.ts`

Antes de llamar a `engine.respond()`:

1. `handoffs.get(contactId)`.
2. Si `isTaken`: no se llama al motor. Se guarda el mensaje
   (`appendInbound`) y se agrega a la sesión de Redis como turno `user`.
   Si `shouldNotify`, aviso al dueño por los canales de `notify`
   ("<nombre o número> te escribió: <texto>", con el enlace al panel) y
   `markNotified`. Responde 200 a Meta y termina.
3. Si hay fila pero ya venció: `release()` y sigue el flujo normal.

Una falla al leer `handoffs` se trata como "no tomada" (el asistente
contesta): mejor una respuesta de más que una persona sin respuesta.

## Avisos — `core/notify.ts`

- `LeadAlert` gana `panelUrl?: string` (va en el correo y en la variable
  "detalle" de la plantilla de WhatsApp) y `inbound?: { name: string; text: string }`
  para el aviso "te escribió" (tipo de aviso en la plantilla:
  `Te escribió (conversación tomada)`).
- Las rutas arman `panelUrl` con `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/panel/conversaciones/<contactId>`;
  sin esa variable (local), no hay enlace.

## Panel

### Server actions — `app/panel/(app)/conversaciones/[contactId]/actions.ts`

Todas: `requireAccess`, el contacto es del cliente del deploy y de canal
`whatsapp`; si no, error.

- `take(contactId)`: upsert en `handoffs` con `taken_by = auth.uid()`, `taken_by_email = user.email`,
  `taken_at = last_human_at = now()` (sesión del usuario, RLS).
- `reply(contactId, text)`:
  1. `text` recortado, no vacío, máximo 4096 caracteres.
  2. `windowOpen` con el último mensaje `user` del contacto; si no, error
     "WhatsApp solo deja escribir libremente 24 h después del último mensaje
     de la persona".
  3. `createWhatsAppAdapter(...).deliver(contactId, { text })` en el
     servidor (token de Meta, nunca en el navegador).
  4. Solo si Meta aceptó: insert en `messages` (`role: 'human'`, sesión del
     usuario), `last_human_at = now()` en `handoffs`, y el texto a la sesión
     de Redis como turno `assistant` (es lo que el negocio dijo; el asistente
     lo verá al retomar).
  5. Si Meta falla: error "No se pudo enviar: <motivo>"; no se guarda nada.
- `giveBack(contactId)`: borra la fila de `handoffs`.

### Pantalla de la conversación

| Estado | Lo que ve el dueño |
|---|---|
| La atiende el asistente | "El asistente está contestando" + **Tomar conversación** |
| La atiendes tú | "La atiendes tú · el asistente la retoma a las HH:MM si no escribes", campo + **Enviar**, **Devolver al asistente**; refresco cada 5 s |
| La atiende otra persona | "La atiende <correo>" + **Tomarla yo** |
| Ventana de 24 h cerrada | campo deshabilitado con la explicación |

- Mensajes `human` en burbuja propia con la etiqueta "Tú".
- En la lista de conversaciones, etiqueta "tomada".
- Conversaciones web: sin cambios.
- `app/panel/(app)/conversaciones/[contactId]/live.tsx`: componente cliente
  que llama `router.refresh()` cada 5 s, montado solo mientras la
  conversación está tomada.

## Carrera conocida

Si el dueño toma la conversación mientras el asistente ya está generando una
respuesta, esa respuesta puede salir una vez. Aceptado.

## Pruebas

- `node core/handoff.ts`: autoprueba (`isTaken` en el borde de 4 h,
  `shouldNotify` a los 15 min, `windowOpen` a las 24 h, `returnsAt`).
- `scripts/check-panel-rls.mjs`: A inserta `human` en su cliente; no puede
  insertar `assistant` ni `user`, ni `human` en otro cliente; toma y devuelve
  solo en su cliente; no ve tomas de otro cliente.
- Evals por WhatsApp (`scripts/evals.ts`, casos genéricos con
  `channel: 'whatsapp'`): con la conversación tomada, el asistente no
  contesta y el mensaje queda en `messages`; con la toma vencida, contesta y
  la fila desaparece.
- `scripts/check-panel-pages.mjs`: tomar crea la fila; enviar a un contacto
  de prueba lo rechaza Meta → la pantalla muestra el error y no se guarda
  ningún mensaje `human`; devolver borra la fila.
- `npm run eval:3dev`, evals del demo, `npx tsc --noEmit`,
  `npm run check:boundary`, `npm run build`.
- De punta a punta con Marco: acceso al panel de `quetzal-3dev`; escribe al
  número de Quetzal desde otro teléfono; toma la conversación; contesta; le
  llega; el asistente no contesta mientras está tomada; la devuelve y el
  asistente responde.

## Documentación

- `CLAUDE.md`: sección "Handoff en vivo"; "Panel del cliente" deja de decir
  solo lectura; la hoja de ruta quita el handoff de lo pendiente.

## Fuera de alcance

Web, plantillas para escribir con la ventana de 24 h cerrada, adjuntos e
imágenes, tool `request_human`, Supabase Realtime.

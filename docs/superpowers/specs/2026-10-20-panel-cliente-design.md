# Panel del cliente — diseño

Fecha: 2026-10-20 · Estado: aprobado en conversación, pendiente de revisión escrita

Pieza 2 de 8 de la plataforma (base de datos ✔ → **panel del cliente** →
handoff en vivo → memoria completa → multi-tenant → panel de 3dev → capa
multi-proveedor → flujos n8n).

## Objetivo

Que el dueño del negocio entre con su correo y vea lo que hizo su asistente:
cifras del periodo, conversaciones completas y leads. Solo lectura. Sirve al
cliente día a día y a 3dev como argumento de venta (se enseña en el demo).

**Éxito:**

- Un correo dado de alta entra con un código de 6 dígitos, sin contraseña.
- Ve solo los datos de su negocio; un correo de otro cliente, o sin acceso,
  no ve nada aunque manipule el navegador (lo impide la base, no solo el código).
- Se lee bien en celular.
- El handoff (pieza 3) puede extenderlo sin rehacerlo.

## Decisiones

- **Solo ver** en la v1: Resumen, Conversaciones (lista + transcripción) y
  Leads.
- **Accesos en Postgres**: tabla `dashboard_users`; dar de alta no pide
  redeploy y RLS la usa.
- **Login con código por correo** (OTP de Supabase Auth): funciona entre
  dispositivos y no lo rompen los escáneres de enlaces.
- **Server Components con la sesión del usuario** (`@supabase/ssr`, llave
  pública) y **RLS como candado**. El panel nunca usa `service_role`.
- **Pestañas arriba**, una columna (mockups aprobados en el compañero visual).
- Vive en el dominio de cada cliente (`/panel`), y muestra el `client_id` de
  ese deploy (un deploy por cliente, como hoy).

## Pantallas

- **Encabezado** (todas): nombre del negocio (`config.organization`), "Panel
  de <config.name>", selector de periodo (`?dias=7|30|90`, default 7),
  pestañas Resumen · Conversaciones · Leads, y "Salir".
- **Resumen** (`/panel`): personas que escribieron, dejaron sus datos (leads),
  citas agendadas, mensajes; y los 5 leads más recientes.
- **Conversaciones** (`/panel/conversaciones`): una fila por contacto con
  mensajes en el periodo, la más reciente arriba. Muestra: nombre (de
  `contacts.name`, o del lead; si no hay, "Visitante web" en web o el número
  completo en WhatsApp), canal, etiquetas "dejó datos" y "agendó", hora del
  último mensaje y su texto recortado. Filtro por canal (`?canal=whatsapp|web`).
  Paginada de 50 en 50 (`?pagina=`).
- **Conversación** (`/panel/conversaciones/[contactId]`): encabezado con
  nombre, canal, teléfono (WhatsApp) o contacto del lead, e interés
  (`contacts.interest`); transcripción completa en burbujas (persona a la
  izquierda, asistente a la derecha), con separador de fecha cuando cambia el
  día. Volver a la lista.
- **Leads** (`/panel/leads`): nombre, contacto con enlace directo (`wa.me/…`
  si es teléfono, `mailto:` si es correo), necesidad, fecha, y "Ver
  conversación".
- **Sin acceso**: "No tienes acceso a este panel" + Salir.

Fechas y horas en la zona y el idioma del cliente (`scheduling.timeZone`,
`locale`).

## Rutas y sesión

| Ruta | Qué hace |
|---|---|
| `/panel/entrar` | Paso 1: correo → server action `signInWithOtp({ email, options: { shouldCreateUser: false } })`. Paso 2: código → `verifyOtp({ email, token, type: 'email' })`; la sesión queda en cookies. |
| `/panel` | Resumen |
| `/panel/conversaciones` | Lista |
| `/panel/conversaciones/[contactId]` | Transcripción |
| `/panel/leads` | Leads |
| `/panel/salir` | `signOut()` y vuelve a `/panel/entrar` |

- `app/panel/(app)/layout.tsx` revisa la sesión (`auth.getUser()`): sin
  sesión → redirect a `/panel/entrar`; con sesión pero sin fila en
  `dashboard_users` para el `client_id` del deploy → pantalla "Sin acceso".
- `middleware.ts` con `matcher: ['/panel/:path*']`: refresca las cookies de
  sesión de `@supabase/ssr`. No toca `/api/*`, el widget ni la página de
  privacidad.

## Base de datos — `supabase/migrations/20261021000000_panel.sql`

```sql
create table dashboard_users (
  user_id   uuid not null references auth.users on delete cascade,
  client_id text not null,
  primary key (user_id, client_id)
);
alter table dashboard_users enable row level security;
create policy "ve sus accesos" on dashboard_users
  for select to authenticated using (user_id = (select auth.uid()));

create policy "panel lee su cliente" on contacts for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel lee su cliente" on messages for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel lee su cliente" on leads for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel lee su cliente" on follow_ups for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
```

- Solo `select`. Ninguna política permite escribir: el panel es de solo
  lectura también en la base.
- `anon` (sin sesión) sigue sin ver nada.

## Datos

- **Postgres** (con la sesión del usuario; cada consulta además filtra
  `.eq('client_id', config.id)`): contactos, mensajes, leads.
- **Citas**: Cal.com desde el servidor, con la llave del cliente, reusando
  `scheduler.bookedPhones(since)`. El Resumen cuenta personas que agendaron;
  la etiqueta "agendó" sale de cruzar esos teléfonos (`metaPhone`) contra el
  `contact_id` de WhatsApp o el teléfono del lead (`leadPhone`). Si Cal.com
  falla, el Resumen muestra "—" y no hay etiquetas "agendó"; la página no cae.
- Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ya
  inyectadas por la integración de Vercel).

## Código

- `app/panel/supabase.ts`: `createPanelClient()` con `createServerClient` de
  `@supabase/ssr` y las cookies de `next/headers`. Única dependencia nueva:
  `@supabase/ssr`.
- `app/panel/shape.ts`: funciones puras (sin red), con autoprueba
  (`node app/panel/shape.ts`): `displayName`, `summarizeConversations`
  (mensajes → filas de la lista), `bookedContactIds` (teléfonos agendados ×
  contactos y leads), `formatWhen` (fecha en la zona del cliente),
  `contactLink` (`wa.me` / `mailto:`).
- `app/panel/data.ts`: consultas (`loadSummary`, `loadConversations`,
  `loadConversation`, `loadLeads`) con `selectAll` donde puede haber más de
  1000 filas.
- `app/panel/panel.css`: estilos con variables; una columna, legible en
  celular.
- `app/panel/(app)/error.tsx`: "No pudimos cargar los datos" + Reintentar.
- Va en `app/` y no en `core/`: depende de Next.

## Errores (pantalla de entrada)

- Correo sin acceso: mismo mensaje que con acceso ("Si tu correo tiene
  acceso, te llegó un código"), para no revelar quién está dado de alta.
- Código incorrecto o vencido: "Código incorrecto o vencido".
- Demasiados intentos (429 de Auth): "Espera un minuto y vuelve a intentar".

## Alta de usuarios — `scripts/panel-user.mjs`

Con `service_role`, solo en la máquina de 3dev:

- `add <correo> <clientId>`: crea el usuario en Auth si no existe
  (`auth.admin.createUser({ email, email_confirm: true })`) e inserta su fila
  en `dashboard_users`.
- `remove <correo> <clientId>`: quita la fila; si no le queda ningún
  cliente, borra el usuario.
- `list <clientId>`: correos con acceso.

## Pasos de Marco

1. Supabase → Authentication → SMTP Settings → Enable custom SMTP: host
   `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = su
   `RESEND_API_KEY`, remitente `notificaciones@3dev.mx`, nombre `Panel Quetzal`.
2. Authentication → Email Templates → **Magic Link**: asunto
   `Tu código para entrar al panel` y cuerpo con `{{ .Token }}` (texto exacto
   en el plan).

## Pruebas

- `node app/panel/shape.ts`: autoprueba de las funciones puras.
- `scripts/check-panel-rls.mjs` contra la base real: crea dos usuarios de
  prueba (clientes `eval-a`, `eval-b`), siembra filas, obtiene una sesión de A
  sin correo (`auth.admin.generateLink` + `verifyOtp` con `token_hash`) y
  verifica: A ve solo `eval-a`; A no puede insertar, actualizar ni borrar; sin
  sesión no ve nada; A solo ve su fila de `dashboard_users`. Limpia todo.
- Rutas: sin sesión, `curl` a `/panel` responde redirect a `/panel/entrar`;
  `/api/chat` sigue respondiendo igual (el middleware no lo toca).
- De punta a punta: Marco dado de alta en `demo-dental` entra con su código y
  recorre las tres pestañas (requiere el SMTP).
- `npm run eval:3dev`, evals del demo, `npx tsc --noEmit`,
  `npm run check:boundary`, `npm run build`.

## Documentación

- `CLAUDE.md`: sección "Panel del cliente".
- `docs/nuevo-cliente.md`: dar de alta al dueño con `panel-user.mjs add`.

## Fuera de alcance

Escribir desde el panel (estados de lead, notas), tiempo real, selector de
varios clientes, exportar CSV, colores por cliente. El handoff (pieza 3)
agrega escritura y tiempo real.

# Postgres (Supabase) — diseño

Fecha: 2026-10-18 · Estado: aprobado en conversación, pendiente de revisión escrita

Pieza 1 de 8 de la plataforma (orden acordado: base de datos → dashboard del
cliente → handoff en vivo → memoria completa → multi-tenant → panel de 3dev →
capa multi-proveedor → flujos n8n).

## Objetivo

Mover los registros de negocio de Redis a Postgres, para que el dashboard, el
handoff, la memoria y el multi-tenant tengan dónde apoyarse. El asistente se
comporta igual: cambia dónde se guarda, no qué hace.

**Éxito:**

- Producción escribe log, leads, fichas y marcas de seguimiento en Postgres.
- El reporte de uso y los evals leen de Postgres.
- La historia que hoy vive en Redis quedó migrada (sin los `eval-*`).
- Los plazos del aviso de privacidad se cumplen solos.
- `npm run eval:3dev` y los evals del demo siguen en verde.

## Decisiones

- **Supabase**: Postgres más Auth y Realtime, que el dashboard (login del
  cliente) y el handoff (mensajes al instante) van a necesitar.
- **Una base compartida** con `client_id` en cada tabla. Row Level Security
  separará a los clientes cuando llegue el dashboard.
- **Migrar una vez** lo que hay en Redis; desde el deploy, todo escribe en
  Postgres.
- **`@supabase/supabase-js` en el servidor** con `service_role`: HTTP, sin
  conexiones que administrar en serverless; es el mismo cliente que usarán
  Auth y Realtime. Sin ORM.
- **Se quedan en Redis** la sesión de 24 h y el límite de mensajes: viven
  poco y Redis los vence solo.

## Esquema — `supabase/migrations/0001_init.sql`

```sql
create table contacts (
  client_id     text not null,
  contact_id    text not null,          -- número en WhatsApp, id de sesión en la web
  channel       text not null,
  name          text,                   -- hoy solo en WhatsApp (ficha)
  interest      text,
  left_contact  boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (client_id, contact_id)
);

create table messages (
  id         bigint generated always as identity primary key,
  client_id  text not null,
  contact_id text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  at         timestamptz not null default now(),
  foreign key (client_id, contact_id) references contacts on delete cascade
);
create index on messages (client_id, at desc);
create index on messages (client_id, contact_id, at);

create table leads (
  id         bigint generated always as identity primary key,
  client_id  text not null,
  contact_id text not null,
  channel    text not null,
  nombre     text not null,
  contacto   text not null,
  necesidad  text,
  at         timestamptz not null default now()
);
create index on leads (client_id, at desc);

create table follow_ups (
  client_id text not null,
  phone     text not null,
  reason    text not null check (reason in ('sent', 'booked')),
  at        timestamptz not null default now(),
  primary key (client_id, phone)
);

alter table contacts   enable row level security;
alter table messages   enable row level security;
alter table leads      enable row level security;
alter table follow_ups enable row level security;
```

- Un mensaje por fila con `role` (no el par usuario/asistente de hoy): es lo
  que muestra un dashboard, y el handoff solo agregará `'human'`.
- RLS activo **sin políticas**: solo `service_role` entra. Nadie lee con la
  llave pública. Las políticas por cliente llegan con el dashboard.
- Los leads no vencen, igual que hoy.

### Plazos (aviso de privacidad) — `pg_cron`

```sql
create extension if not exists pg_cron;

create function purge_expired() returns void language sql as $$
  delete from messages where at < now() - interval '12 months';
  update contacts set name = null, interest = null
    where last_seen_at < now() - interval '90 days'
      and (name is not null or interest is not null);
  delete from follow_ups where at < now() - interval '90 days';
$$;

select cron.schedule('purge-expired', '0 9 * * *', 'select purge_expired()');
```

- Conversaciones: 12 meses (el aviso lo promete).
- Ficha (nombre e interés): 90 días desde el último mensaje (el aviso de 3dev
  lo promete; hoy es el TTL de `profile:`).
- Marcas de seguimiento: 90 días (hoy es su TTL).

## Código

### `core/store/db.ts` (nuevo)

Cliente de Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) y las cuatro
piezas que se mudan, **con las interfaces de hoy** (salvo `ProfileStore.set`, abajo) (`ConversationLog`,
`LeadStore`, `FollowUpStore`, `ProfileStore` y sus tipos se mueven aquí):

- `createConversationLog(clientId).append(entry)`: upsert del contacto
  (`channel`, `last_seen_at = entry.at`; `first_seen_at` solo al crearlo) e
  insert de 2 filas en `messages` (`user`, `assistant`) con `at = entry.at`.
- `createLeadStore(clientId)`: `save` inserta; `list` regresa los leads del
  cliente ordenados por `at` ascendente, con la forma `StoredLead` de hoy.
- `createFollowUpStore(clientId)`: `has(phone)` = existe fila con `at` dentro
  de 90 días; `mark(phone, reason)` = upsert con `at = now()`.
- `createProfileStore(clientId)`: `get` regresa `ContactProfile` desde
  `contacts` (null si no hay fila, o si `last_seen_at` pasa de 90 días);
  `set(contactId, profile, channel)` hace upsert de `name`, `interest`,
  `left_contact`, `last_seen_at`. Único cambio de interfaz: `set` recibe el
  canal, porque `contacts.channel` es obligatorio si la fila no existe aún
  (la ruta de WhatsApp pasa `'whatsapp'`).

Funciones puras exportadas para las autopruebas y la migración:
`logEntryToMessages`, `leadToRow`/`rowToLead`, `profileToContact`/`contactToProfile`.

Un error de Supabase lanza, igual que hoy Redis.

### `core/store/session-store.ts`

Se queda solo con `createSessionStore` y `createRateLimiter` (Redis).

### Rutas (`app/api/chat`, `app/api/whatsapp`, `app/api/cron/follow-up`)

- Cambia el import de las cuatro piezas a `core/store/db`.
- **Una falla del log no tumba la conversación**: `append(...).catch(log)`.
- **Una falla al guardar el lead no impide el aviso**: `save(...).catch(log)`
  y el aviso sale igual (lleva los datos por correo, así que el lead no se
  pierde).

### Variables

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, solo en el servidor.
**`SUPABASE_SERVICE_ROLE_KEY` nunca con prefijo `NEXT_PUBLIC_`**: salta RLS y
abre la base entera.

## Migración de datos — `scripts/migrate-redis.mjs`

Orden: (1) aplicar el esquema (`npx supabase db push --db-url`, ver abajo), (2) desplegar el
código, (3) correr el script. Desde el deploy nada nuevo cae en Redis, así que
el script copia solo lo anterior y no hay cruce. Todo antes de las 16:00 UTC
(cron de seguimiento).

Por cada `clientId` (`quetzal-3dev`, `demo-dental`):

- `log:<id>:<día>` → `contacts` (upsert, `first_seen_at` = primer turno,
  `last_seen_at` = último) + `messages` (2 por turno).
- `leads:<id>` → `leads`.
- `profile:<id>:<contactId>` → `contacts` (`name`, `interest`,
  `left_contact`, `last_seen_at`).
- `followup:<id>:<número>` → `follow_ups`, con `at = now() - (90 días - TTL)`.
- Se salta todo contactId `eval-*`.
- Se niega a correr si Postgres ya tiene mensajes del cliente anteriores al
  último turno de Redis (ya se migró), salvo `--force`. "Tiene filas" no
  sirve de guarda: después del deploy, el tráfico nuevo ya escribe ahí.
- Al terminar imprime filas copiadas por tabla, para comparar contra Redis.

Las llaves de Redis no se borran: vencen solas (90 días), y sirven de
respaldo mientras tanto.

## Evals y reporte

- `scripts/evals.ts`: leads y fichas se leen de Supabase; la sesión sigue en
  Redis. La limpieza borra de `contacts` (en cascada `messages`) y de `leads`
  las filas de los contactIds de la corrida.
- `scripts/report.mjs`: personas, mensajes y origen salen de `messages` y
  `contacts`; leads de `leads`; seguimientos de `follow_ups`. Mismo formato
  de salida que hoy.

## Pruebas

- **Autopruebas** (`node core/store/db.ts`) de las funciones puras: log → 2
  mensajes, lead ida y vuelta, ficha ↔ contacto.
- **`scripts/check-purge.mjs`** contra la base real: siembra filas viejas con
  `client_id = 'eval-purge'`, corre `purge_expired()`, verifica que se borró
  o vació lo que debía y que lo reciente sigue, y limpia.
- **Suites**: `npm run eval:3dev` y los evals del demo, escribiendo en Supabase.
- `npx tsc --noEmit`, `npm run check:boundary`, `npm run build`.
- **Migración**: comparar las cuentas del script contra las de Redis, y
  `npm run report:3dev -- 30` antes y después (mismas cifras).

## Documentación

- `CLAUDE.md`: "Registro de conversaciones", "Ficha de contacto",
  "Seguimiento automático" (dónde vive la marca) y la hoja de ruta.
- `docs/nuevo-cliente.md`: las dos variables; el `client_id` es el `id` de la
  config.
- `scripts/client-check.ts`: revisa que Supabase responda.

## Pasos de Marco — hechos (2026-10-19)

1. Proyecto de Supabase creado desde el Marketplace de Vercel y conectado a
   `3dev-quetzal` y `quetzal-demo-dental` (ref `eotzniifzbsfmapirceq`).
2. `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` copiadas a `.env.local` y
   `.env.demo-dental`.

El esquema se aplica sin `supabase login`:
`npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING"` (la conexión
directa que el Marketplace dejó en Vercel; se baja con `vercel env pull` a un
archivo temporal y no se guarda).

## Fuera de alcance

Dashboard, login, políticas RLS por cliente, handoff, memoria en la web,
multi-tenant (piezas 2 a 5).

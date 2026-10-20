# Postgres (Supabase) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log de conversaciones, leads, fichas de contacto y marcas de seguimiento pasan de Redis a Postgres (Supabase), con la historia migrada y los plazos del aviso de privacidad aplicados por la base.

**Architecture:** Esquema SQL en `supabase/migrations/`, aplicado con la CLI de Supabase. `core/store/db.ts` implementa las mismas interfaces de store que hoy (`ConversationLog`, `LeadStore`, `FollowUpStore`, `ProfileStore`) sobre `@supabase/supabase-js` con `service_role`; las rutas solo cambian el import. Sesión y límite de mensajes siguen en Redis. Un script copia una vez lo que hay en Redis después del deploy.

**Tech Stack:** Next.js 15, TypeScript (Node 24 corre `.ts` directo), `@supabase/supabase-js`, Supabase CLI vía `npx`, Postgres + `pg_cron`, Upstash Redis.

**Spec:** `docs/superpowers/specs/2026-10-18-postgres-supabase-design.md`

## Global Constraints

- Ningún archivo bajo `core/` nombra a un cliente: `npm run check:boundary` debe pasar.
- Sesión (24 h) y límite de mensajes se quedan en Redis.
- `SUPABASE_SERVICE_ROLE_KEY` nunca lleva prefijo `NEXT_PUBLIC_`, nunca se imprime ni se commitea.
- Una sola dependencia nueva: `@supabase/supabase-js`. La CLI corre con `npx supabase@2.121.0`, sin instalarse.
- Plazos: mensajes 12 meses; nombre e interés del contacto 90 días desde `last_seen_at`; marcas de seguimiento 90 días; leads sin vencimiento.
- Toda fila lleva `client_id` = el `id` de la config (`quetzal-3dev`, `demo-dental`).
- No correr `npm run build` con el dev server encendido. Dev server en segundo plano: `caffeinate -i`.
- No subir a git ni desplegar sin que Marco lo pida.
- Código en inglés, texto de cara al usuario en español, comentarios solo para el *por qué*.

## Review Focus

1. **`next build` o un deploy de Preview sin las variables de Supabase**: importar `core/store/db.ts` no truena; solo falla la llamada que de verdad toca la base. → Task 2, autoprueba `lazy client`.
2. **Supabase caído o lento a media conversación**: la persona recibe su respuesta y el aviso del lead sale igual. → Task 3, Step 7 (dev server con `SUPABASE_URL` inválida).
3. **Más de 1000 filas** (PostgREST corta en 1000 por defecto): `leads.list()` y el reporte regresan todas. → Task 2, `selectAll` en autoprueba y 1001 leads en `check-db`.
4. **Dos mensajes simultáneos de un contacto nuevo**: los dos upserts del contacto terminan bien, sin choque de llave primaria. → Task 2, `check-db`.
5. **`first_seen_at` no se pisa** con los mensajes siguientes, y una ficha guardada antes que cualquier mensaje crea el contacto con su canal. → Task 2, `check-db`.

---

## Mapa de archivos

| Archivo | Cambio | Responsabilidad |
|---|---|---|
| `supabase/migrations/20261019000000_init.sql` | Crear | Tablas, índices, RLS, `purge_expired()`, `pg_cron` |
| `scripts/check-purge.mjs` | Crear | Prueba de `purge_expired()` contra la base real |
| `core/store/db.ts` | Crear | Cliente perezoso, mapeos puros, los cuatro stores |
| `scripts/check-db.mjs` | Crear | Prueba de integración de `db.ts` contra la base real |
| `core/store/session-store.ts` | Modificar | Queda solo sesión y límite (Redis) |
| `app/api/chat/route.ts`, `app/api/whatsapp/route.ts`, `app/api/cron/follow-up/route.ts` | Modificar | Imports y tolerancia a fallas |
| `scripts/evals.ts`, `scripts/report.mjs`, `scripts/client-check.ts` | Modificar | Leen Supabase |
| `scripts/migrate-redis.mjs` | Crear | Copia única Redis → Postgres |
| `CLAUDE.md`, `docs/nuevo-cliente.md` | Modificar | Documentación |
| `package.json` | Modificar | `@supabase/supabase-js` |

---

### Task 1: Esquema y plazos de conservación

**Files:**
- Create: `supabase/migrations/20261019000000_init.sql`
- Create: `scripts/check-purge.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: tablas `contacts`, `messages`, `leads`, `follow_ups` (columnas exactas abajo) y la función `purge_expired()`.

- [ ] **Step 1: Prueba de los plazos (falla: no hay tablas)**

Crear `scripts/check-purge.mjs`:

```js
// Prueba purge_expired() contra la base real con client_id 'eval-purge'.
//   node --env-file=.env.local scripts/check-purge.mjs
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const C = 'eval-purge';
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const cleanup = async () => {
  await must(sb.from('follow_ups').delete().eq('client_id', C));
  await must(sb.from('contacts').delete().eq('client_id', C));
};

await cleanup();
try {
  await must(sb.from('contacts').insert([
    { client_id: C, contact_id: 'viejo', channel: 'whatsapp', name: 'Ana', interest: 'web', last_seen_at: ago(100), first_seen_at: ago(400) },
    { client_id: C, contact_id: 'reciente', channel: 'whatsapp', name: 'Luis', interest: 'tienda', last_seen_at: ago(5), first_seen_at: ago(5) },
  ]));
  await must(sb.from('messages').insert([
    { client_id: C, contact_id: 'viejo', role: 'user', content: 'hace más de un año', at: ago(400) },
    { client_id: C, contact_id: 'viejo', role: 'user', content: 'hace 100 días', at: ago(100) },
  ]));
  await must(sb.from('follow_ups').insert([
    { client_id: C, phone: '520000000001', reason: 'sent', at: ago(100) },
    { client_id: C, phone: '520000000002', reason: 'sent', at: ago(10) },
  ]));

  await must(sb.rpc('purge_expired'));

  const contacts = await must(sb.from('contacts').select('contact_id, name, interest').eq('client_id', C).order('contact_id'));
  assert.deepEqual(contacts, [
    { contact_id: 'reciente', name: 'Luis', interest: 'tienda' },
    { contact_id: 'viejo', name: null, interest: null },
  ], 'la ficha de 90 días se vacía, la reciente se queda, la fila sobrevive');
  const messages = await must(sb.from('messages').select('content').eq('client_id', C));
  assert.deepEqual(messages.map((m) => m.content), ['hace 100 días'], 'solo se borra lo de más de 12 meses');
  const marks = await must(sb.from('follow_ups').select('phone').eq('client_id', C));
  assert.deepEqual(marks.map((m) => m.phone), ['520000000002'], 'la marca de más de 90 días se borra');
  console.log('check-purge: passed');
} finally {
  await cleanup();
}
```

- [ ] **Step 2: Instalar el cliente y ver la prueba fallar**

Run: `npm install @supabase/supabase-js@^2.118.0 && node --env-file=.env.local scripts/check-purge.mjs`
Expected: FAIL con un error de PostgREST del estilo `relation "public.follow_ups" does not exist` / `Could not find the table`.

- [ ] **Step 3: Esquema**

Crear `supabase/migrations/20261019000000_init.sql`:

```sql
-- Registros de negocio de todos los clientes; client_id = el id de la config.
create table contacts (
  client_id     text not null,
  contact_id    text not null,
  channel       text not null,
  name          text,
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
create index messages_client_at on messages (client_id, at desc);
create index messages_contact_at on messages (client_id, contact_id, at);

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
create index leads_client_at on leads (client_id, at desc);

create table follow_ups (
  client_id text not null,
  phone     text not null,
  reason    text not null check (reason in ('sent', 'booked')),
  at        timestamptz not null default now(),
  primary key (client_id, phone)
);

-- Sin políticas: solo service_role entra. Las de cada cliente llegan con el dashboard.
alter table contacts   enable row level security;
alter table messages   enable row level security;
alter table leads      enable row level security;
alter table follow_ups enable row level security;

-- Plazos del aviso de privacidad.
create function purge_expired() returns void language sql as $$
  delete from messages where at < now() - interval '12 months';
  update contacts set name = null, interest = null
    where last_seen_at < now() - interval '90 days'
      and (name is not null or interest is not null);
  delete from follow_ups where at < now() - interval '90 days';
$$;
-- Expuesta por RPC: que no la pueda llamar la llave pública.
revoke execute on function purge_expired() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purge-expired', '0 9 * * *', 'select purge_expired()');
```

- [ ] **Step 4: Aplicar el esquema**

```bash
T=$(mktemp /private/tmp/claude-501/-Users-marcohernandez-quetzal/60bcd3fb-2a77-47f8-b1e9-05ce0e49745e/scratchpad/env.XXXXXX)
npx -y vercel@latest env pull "$T" --environment=production --yes >/dev/null
DBURL=$(grep '^POSTGRES_URL_NON_POOLING=' "$T" | cut -d= -f2- | tr -d '"'); rm -f "$T"
npx -y supabase@2.121.0 db push --db-url "$DBURL" --yes
```

Expected: `Applying migration 20261019000000_init.sql... Finished supabase db push.` Si la CLI pide `supabase/config.toml`, correr `npx -y supabase@2.121.0 init` (lo crea) y repetir. Nunca imprimir `$DBURL`.

- [ ] **Step 5: Ver la prueba pasar**

Run: `node --env-file=.env.local scripts/check-purge.mjs`
Expected: `check-purge: passed`

- [ ] **Step 6: Commit**

```bash
git add supabase/ scripts/check-purge.mjs package.json package-lock.json
git commit -m "feat: esquema de Postgres con los plazos del aviso de privacidad"
```

---

### Task 2: `core/store/db.ts`

**Files:**
- Create: `core/store/db.ts`
- Create: `scripts/check-db.mjs`

**Interfaces:**
- Consumes (Task 1): tablas y columnas de `20261019000000_init.sql`.
- Produces:
  - `export function db(): SupabaseClient`
  - `export async function selectAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]>`
  - Tipos `LogEntry`, `ConversationLog`, `StoredLead`, `LeadStore`, `FollowUpStore`, `ContactProfile`, `ProfileStore`, `MessageRow`, `LeadRow`, `ContactRow`
  - `logEntryToMessages(clientId, entry): MessageRow[]`, `leadToRow(clientId, lead): LeadRow`, `rowToLead(row): StoredLead`, `profileToContact(clientId, contactId, channel, profile): ContactRow`, `contactToProfile(row, now: Date): ContactProfile | null`
  - `createConversationLog(clientId)`, `createLeadStore(clientId)`, `createFollowUpStore(clientId)`, `createProfileStore(clientId)` — `ProfileStore.set(contactId, profile, channel)`

- [ ] **Step 1: Autoprueba de las funciones puras (falla: no existe el archivo)**

Crear `core/store/db.ts` con este bloque de autoprueba al final (el resto se escribe en el Step 3):

```ts
// Self-check: `node core/store/db.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const at = new Date('2026-10-01T15:00:00.000Z');
  assert.deepEqual(
    logEntryToMessages('c', { channel: 'web', contactId: 's1', userText: 'hola', assistantText: '¿qué tal?', at }),
    [
      { client_id: 'c', contact_id: 's1', role: 'user', content: 'hola', at: '2026-10-01T15:00:00.000Z' },
      { client_id: 'c', contact_id: 's1', role: 'assistant', content: '¿qué tal?', at: '2026-10-01T15:00:00.000Z' },
    ],
  );

  const lead = { nombre: 'Ana', contacto: '2225550101', channel: 'web', contactId: 's1', at: '2026-10-01T15:00:00.000Z' };
  assert.deepEqual(rowToLead(leadToRow('c', lead)), lead, 'sin necesidad, ida y vuelta queda igual');
  assert.equal(leadToRow('c', lead).necesidad, null);
  assert.equal(rowToLead(leadToRow('c', { ...lead, necesidad: 'web' })).necesidad, 'web');

  const profile = { name: 'Ana', interest: 'tienda', leftContact: true, lastSeenAt: '2026-10-01T15:00:00.000Z' };
  const row = profileToContact('c', '5212225550101', 'whatsapp', profile);
  assert.equal(row.channel, 'whatsapp');
  assert.ok(!('first_seen_at' in row), 'un upsert de ficha no pisa first_seen_at');
  assert.deepEqual(contactToProfile(row, new Date('2026-10-02T00:00:00Z')), profile);
  assert.equal(contactToProfile(row, new Date('2027-01-15T00:00:00Z')), null, 'pasados 90 días no hay ficha');
  assert.equal(
    contactToProfile({ ...row, name: null, interest: null, left_contact: false }, new Date('2026-10-02T00:00:00Z')),
    null,
    'un contacto del que no sabemos nada no es ficha',
  );

  // selectAll: junta páginas de 1000 hasta una incompleta.
  const pages = [Array(1000).fill(1), Array(5).fill(2)];
  let calls = 0;
  const all = await selectAll(async () => ({ data: pages[calls++] ?? [], error: null }));
  assert.equal(all.length, 1005);
  assert.equal(calls, 2);

  // lazy client: sin variables, construir stores no truena; usarlos sí.
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const leads = createLeadStore('c');
  await assert.rejects(leads.list(), /SUPABASE_URL/);
  process.env.SUPABASE_URL = saved.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;

  console.log('db.ts self-check passed');
}
```

Arriba del bloque, por ahora solo: `import assert from 'node:assert';`.

Run: `node core/store/db.ts`
Expected: FAIL con `ReferenceError: logEntryToMessages is not defined`.

- [ ] **Step 2: Prueba de integración (falla: no hay stores)**

Crear `scripts/check-db.mjs`:

```js
// Prueba core/store/db.ts contra la base real con client_id 'eval-db'.
//   node --env-file=.env.local scripts/check-db.mjs
import assert from 'node:assert';
import { db, createConversationLog, createLeadStore, createFollowUpStore, createProfileStore } from '../core/store/db.ts';

const C = 'eval-db';
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const cleanup = async () => {
  await must(db().from('leads').delete().eq('client_id', C));
  await must(db().from('follow_ups').delete().eq('client_id', C));
  await must(db().from('contacts').delete().eq('client_id', C));
};

await cleanup();
try {
  const log = createConversationLog(C);
  const turn = (text, at) => ({ channel: 'web', contactId: 'nuevo', userText: text, assistantText: 'ok', at });

  // Dos mensajes simultáneos de un contacto nuevo.
  const first = new Date(Date.now() - 60_000);
  await Promise.all([log.append(turn('uno', first)), log.append(turn('dos', first))]);
  await log.append(turn('tres', new Date()));
  const contact = (await must(db().from('contacts').select('*').eq('client_id', C).eq('contact_id', 'nuevo')))[0];
  assert.equal(new Date(contact.first_seen_at).toISOString(), first.toISOString(), 'first_seen_at no se pisa');
  assert.ok(new Date(contact.last_seen_at) > first, 'last_seen_at avanza');
  const messages = await must(db().from('messages').select('role').eq('client_id', C));
  assert.equal(messages.length, 6, '3 turnos = 6 mensajes');

  // Ficha antes que cualquier mensaje.
  const profiles = createProfileStore(C);
  await profiles.set('5212225550101', { name: 'Ana', interest: 'tienda', lastSeenAt: new Date().toISOString() }, 'whatsapp');
  assert.equal((await profiles.get('5212225550101'))?.name, 'Ana');
  assert.equal(await profiles.get('nuevo'), null, 'un contacto web sin datos no tiene ficha');
  assert.equal(await profiles.get('nadie'), null);

  // Más de 1000 leads.
  const rows = Array.from({ length: 1001 }, (_, i) => ({ client_id: C, contact_id: `s${i}`, channel: 'web', nombre: `L${i}`, contacto: 'x@y.mx' }));
  await must(db().from('leads').insert(rows));
  const leads = createLeadStore(C);
  await leads.save({ nombre: 'Último', contacto: '2225550101', channel: 'web', contactId: 's-last', at: new Date().toISOString() });
  const listed = await leads.list();
  assert.equal(listed.length, 1002, 'list() no se queda en 1000');
  assert.equal(listed.at(-1).nombre, 'Último', 'ordenados por fecha');

  // Marcas de seguimiento.
  const marks = createFollowUpStore(C);
  await marks.mark('520000000001', 'sent');
  assert.ok(await marks.has('520000000001'));
  await must(db().from('follow_ups').insert({ client_id: C, phone: '520000000002', reason: 'sent', at: new Date(Date.now() - 100 * 864e5).toISOString() }));
  assert.ok(!(await marks.has('520000000002')), 'una marca de hace 100 días ya no cuenta');
  assert.ok(!(await marks.has('520000000003')));

  console.log('check-db: passed');
} finally {
  await cleanup();
}
```

Run: `node --env-file=.env.local scripts/check-db.mjs`
Expected: FAIL con `SyntaxError: The requested module '../core/store/db.ts' does not provide an export named 'db'`.

- [ ] **Step 3: Implementar `db.ts`**

Reemplazar el inicio de `core/store/db.ts` (todo lo que va antes del bloque de autoprueba) por:

```ts
import assert from 'node:assert';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CapturedLead } from '../tools';

let client: SupabaseClient | null = null;

/**
 * Lazy: `next build` imports every route without the env, and a Preview
 * deploy may lack it. Only a call that actually touches the database fails.
 */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** PostgREST hands back at most 1000 rows per request unless asked for the rest. */
const PAGE = 1000;

export async function selectAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function must<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Same 90 days the privacy notice promises and purge_expired() enforces. */
const PROFILE_DAYS = 90;
const FOLLOW_UP_DAYS = 90;

export interface LogEntry {
  channel: string;
  contactId: string;
  userText: string;
  assistantText: string;
  at: Date;
}

export interface ConversationLog {
  append(entry: LogEntry): Promise<void>;
}

export interface StoredLead extends CapturedLead {
  channel: string;
  contactId: string;
  at: string;
}

export interface LeadStore {
  save(lead: StoredLead): Promise<void>;
  list(): Promise<StoredLead[]>;
}

/**
 * Who already got the one follow-up, or booked and needs none. Keyed by the
 * number Meta delivers to, so the same person reached from web and from
 * WhatsApp counts once.
 */
export interface FollowUpStore {
  has(phone: string): Promise<boolean>;
  mark(phone: string, reason: 'sent' | 'booked'): Promise<void>;
}

/**
 * What survives a conversation: enough to greet someone by name and pick up
 * the thread, not the transcript.
 */
export interface ContactProfile {
  name?: string;
  interest?: string;
  leftContact?: boolean;
  lastSeenAt: string;
}

export interface ProfileStore {
  get(contactId: string): Promise<ContactProfile | null>;
  /** The channel is needed when this creates the contact. */
  set(contactId: string, profile: ContactProfile, channel: string): Promise<void>;
}

export interface MessageRow {
  client_id: string;
  contact_id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface LeadRow {
  client_id: string;
  contact_id: string;
  channel: string;
  nombre: string;
  contacto: string;
  necesidad: string | null;
  at: string;
}

export interface ContactRow {
  client_id: string;
  contact_id: string;
  channel: string;
  name: string | null;
  interest: string | null;
  left_contact: boolean;
  last_seen_at: string;
  first_seen_at?: string;
}

/** One row per message: what a dashboard lists, and what handoff will append to. */
export function logEntryToMessages(clientId: string, entry: LogEntry): MessageRow[] {
  const at = entry.at.toISOString();
  const base = { client_id: clientId, contact_id: entry.contactId, at };
  return [
    { ...base, role: 'user', content: entry.userText },
    { ...base, role: 'assistant', content: entry.assistantText },
  ];
}

export function leadToRow(clientId: string, lead: StoredLead): LeadRow {
  return {
    client_id: clientId,
    contact_id: lead.contactId,
    channel: lead.channel,
    nombre: lead.nombre,
    contacto: lead.contacto,
    necesidad: lead.necesidad ?? null,
    at: lead.at,
  };
}

export function rowToLead(row: LeadRow): StoredLead {
  return {
    nombre: row.nombre,
    contacto: row.contacto,
    ...(row.necesidad ? { necesidad: row.necesidad } : {}),
    channel: row.channel,
    contactId: row.contact_id,
    at: new Date(row.at).toISOString(),
  };
}

/** No first_seen_at: an upsert must not move when someone first wrote. */
export function profileToContact(clientId: string, contactId: string, channel: string, profile: ContactProfile): ContactRow {
  return {
    client_id: clientId,
    contact_id: contactId,
    channel,
    name: profile.name ?? null,
    interest: profile.interest ?? null,
    left_contact: !!profile.leftContact,
    last_seen_at: profile.lastSeenAt,
  };
}

/** Null when there is nothing to remember, or it lapsed: a web visit is a contact, not a profile. */
export function contactToProfile(row: ContactRow, now: Date): ContactProfile | null {
  if (!row.name && !row.interest && !row.left_contact) return null;
  if (now.getTime() - new Date(row.last_seen_at).getTime() > PROFILE_DAYS * DAY_MS) return null;
  return {
    ...(row.name ? { name: row.name } : {}),
    ...(row.interest ? { interest: row.interest } : {}),
    leftContact: row.left_contact,
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
  };
}

export function createConversationLog(clientId: string): ConversationLog {
  return {
    async append(entry) {
      // Upsert touches only channel and last_seen_at: first_seen_at keeps its default from the insert.
      await must(
        db()
          .from('contacts')
          .upsert(
            { client_id: clientId, contact_id: entry.contactId, channel: entry.channel, last_seen_at: entry.at.toISOString() },
            { onConflict: 'client_id,contact_id' },
          ),
      );
      await must(db().from('messages').insert(logEntryToMessages(clientId, entry)));
    },
  };
}

/** A captured lead is a business record someone has to follow up on: it never expires. */
export function createLeadStore(clientId: string): LeadStore {
  return {
    async save(lead) {
      await must(db().from('leads').insert(leadToRow(clientId, lead)));
    },
    async list() {
      const rows = await selectAll<LeadRow>((from, to) =>
        db()
          .from('leads')
          .select('client_id, contact_id, channel, nombre, contacto, necesidad, at')
          .eq('client_id', clientId)
          .order('at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      return rows.map(rowToLead);
    },
  };
}

export function createFollowUpStore(clientId: string): FollowUpStore {
  return {
    async has(phone) {
      const since = new Date(Date.now() - FOLLOW_UP_DAYS * DAY_MS).toISOString();
      const rows = await must(
        db().from('follow_ups').select('phone').eq('client_id', clientId).eq('phone', phone).gte('at', since).limit(1),
      );
      return rows.length > 0;
    },
    async mark(phone, reason) {
      await must(
        db()
          .from('follow_ups')
          .upsert({ client_id: clientId, phone, reason, at: new Date().toISOString() }, { onConflict: 'client_id,phone' }),
      );
    },
  };
}

export function createProfileStore(clientId: string): ProfileStore {
  return {
    async get(contactId) {
      const row = await must(
        db()
          .from('contacts')
          .select('client_id, contact_id, channel, name, interest, left_contact, last_seen_at')
          .eq('client_id', clientId)
          .eq('contact_id', contactId)
          .maybeSingle(),
      );
      return row ? contactToProfile(row as ContactRow, new Date()) : null;
    },
    async set(contactId, profile, channel) {
      await must(
        db().from('contacts').upsert(profileToContact(clientId, contactId, channel, profile), { onConflict: 'client_id,contact_id' }),
      );
    },
  };
}
```

- [ ] **Step 4: Ver las dos pruebas pasar**

Run: `node core/store/db.ts && node --env-file=.env.local scripts/check-db.mjs && npm run -s check:boundary && npx tsc --noEmit`
Expected: `db.ts self-check passed`, `check-db: passed`, y sin errores.

- [ ] **Step 5: Commit**

```bash
git add core/store/db.ts scripts/check-db.mjs
git commit -m "feat: stores de log, leads, fichas y seguimientos sobre Postgres"
```

---

### Task 3: Rutas, evals, reporte y client-check sobre Postgres

**Files:**
- Modify: `core/store/session-store.ts` (quitar log, leads, seguimientos y fichas)
- Modify: `app/api/chat/route.ts`, `app/api/whatsapp/route.ts`, `app/api/cron/follow-up/route.ts`
- Modify: `scripts/evals.ts`, `scripts/report.mjs`, `scripts/client-check.ts`

**Interfaces:**
- Consumes (Task 2): `createConversationLog`, `createLeadStore`, `createFollowUpStore`, `createProfileStore`, `db`, `selectAll`.
- Produces: producción escribe en Postgres; `report.mjs <clientId> [días]` con la misma salida de hoy.

- [ ] **Step 1: `session-store.ts`**

Borrar de `core/store/session-store.ts` todo desde `export interface LogEntry` hasta el final del archivo (log, leads, seguimientos, fichas), y el import `import type { CapturedLead } from '../tools';`. Quedan `kv`, `SESSION_TTL_SECONDS`, `SessionStore`, `createSessionStore`, `RateLimiter`, `createRateLimiter`.

- [ ] **Step 2: Ruta web (`app/api/chat/route.ts`)**

Imports:

```ts
import { createSessionStore, createRateLimiter } from '../../../core/store/session-store';
import { createConversationLog, createLeadStore, createFollowUpStore } from '../../../core/store/db';
```

Reemplazar el `await createConversationLog(config.id).append({ ... });` por la misma llamada sin `await` y con catch:

```ts
    // The log is a record, not the reply: a database hiccup must not cost the person their answer.
    await createConversationLog(config.id)
      .append({
        channel: 'web',
        contactId: inbound.contactId,
        userText: inbound.text,
        assistantText: result.reply.text,
        at: new Date(),
      })
      .catch((error) => console.error(`[${config.id}] conversation log failed`, error));
```

Y el `await createLeadStore(config.id).save({ ... });` por:

```ts
      // The alert below carries the same data: a failed save must not also lose it.
      await createLeadStore(config.id)
        .save({
          ...result.capturedLead,
          channel: 'web',
          contactId: inbound.contactId,
          at: new Date().toISOString(),
        })
        .catch((error) => console.error(`[${config.id}] lead save failed`, error));
```

- [ ] **Step 3: Ruta de WhatsApp (`app/api/whatsapp/route.ts`)**

Imports:

```ts
import { createSessionStore, createRateLimiter } from '../../../core/store/session-store';
import { createConversationLog, createLeadStore, createFollowUpStore, createProfileStore } from '../../../core/store/db';
```

Mismos dos cambios que en la ruta web (log y lead con `.catch`, `channel: 'whatsapp'`), y `profiles.set(...)` recibe el canal:

```ts
      await profiles.set(
        inbound.contactId,
        {
          name: remembered?.nombre || capturedLead?.nombre || profile?.name,
          interest: remembered?.interes || capturedLead?.necesidad || profile?.interest,
          leftContact: profile?.leftContact || !!capturedLead,
          lastSeenAt: new Date().toISOString(),
        },
        'whatsapp',
      );
```

- [ ] **Step 4: Cron (`app/api/cron/follow-up/route.ts`)**

Imports:

```ts
import { createSessionStore } from '../../../../core/store/session-store';
import { createFollowUpStore, createLeadStore } from '../../../../core/store/db';
```

- [ ] **Step 5: Evals (`scripts/evals.ts`)**

Agregar `import { db } from '../core/store/db.ts';`. Reemplazar `leadFor`:

```ts
  const leadFor = async (contactId: string) => {
    const { data, error } = await db()
      .from('leads')
      .select('contact_id, nombre, channel')
      .eq('client_id', clientId)
      .eq('contact_id', contactId);
    if (error) throw error;
    return data?.[0] ? { contactId: data[0].contact_id, nombre: data[0].nombre, channel: data[0].channel } : undefined;
  };
```

En el caso "si vuelve otro día", la ficha:

```ts
        const { data: row } = await db().from('contacts').select('name').eq('client_id', clientId).eq('contact_id', contactId).maybeSingle();
        assert.match(row?.name ?? '', /laura/i, `no guardó el nombre en la ficha: ${JSON.stringify(row)}`);
```

(la línea siguiente, `await kv.del(\`session:${contactId}\`)`, se queda: la sesión sigue en Redis).

En `cleanup`, reemplazar el borrado de `profile:` y todo el bloque de `leads:` por:

```ts
  for (const id of sessionIds) await kv.del(`session:${id}`);
  if (sessionIds.length) {
    // Cascades to their messages: an eval leaves no trace in the conversation log.
    const contacts = await db().from('contacts').delete().eq('client_id', clientId).in('contact_id', sessionIds);
    const leads = await db().from('leads').delete().eq('client_id', clientId).in('contact_id', sessionIds);
    if (contacts.error || leads.error) console.error('cleanup de Supabase falló', contacts.error ?? leads.error);
  }
```

- [ ] **Step 6: Reporte (`scripts/report.mjs`)**

Reemplazar desde `import { Redis }` hasta el bloque de "Seguimientos" (incluido) por:

```js
import { db, selectAll } from '../core/store/db.ts';

const [clientId, daysArg = '7'] = process.argv.slice(2);
if (!clientId) {
  console.error('Uso: node --env-file=.env.local scripts/report.mjs <clientId> [días]');
  process.exit(1);
}
const days = Number(daysArg);
const exclude = new Set((process.env.REPORT_EXCLUDE ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const isReal = (id = '') => !id.startsWith('eval') && !exclude.has(id);

const since = new Date(Date.now() - days * 864e5);
const dates = Array.from({ length: days + 1 }, (_, i) =>
  new Date(since.getTime() + i * 864e5).toISOString().slice(0, 10),
);
const rows = (table, columns) =>
  selectAll((from, to) =>
    db().from(table).select(columns).eq('client_id', clientId).gte('at', since.toISOString()).order('at').order(table === 'follow_ups' ? 'phone' : 'id').range(from, to),
  );

// Conversaciones: un turno es un mensaje de la persona.
const contactChannel = new Map(
  (await selectAll((from, to) => db().from('contacts').select('contact_id, channel').eq('client_id', clientId).order('contact_id').range(from, to)))
    .map((c) => [c.contact_id, c.channel]),
);
const turns = (await rows('messages', 'contact_id, role, content, at'))
  .filter((m) => m.role === 'user' && isReal(m.contact_id))
  .map((m) => ({ contactId: m.contact_id, channel: contactChannel.get(m.contact_id), userText: m.content, at: new Date(m.at).toISOString() }));

const people = new Map();
for (const t of turns) people.set(t.contactId, t.channel);

// De dónde llegó: los enlaces del kit de tráfico abren WhatsApp con
// "Hola, vengo de <canal>…". Sin esa frase, cuenta como directo.
const firstText = new Map();
for (const t of turns) if (!firstText.has(t.contactId)) firstText.set(t.contactId, t.userText ?? '');
const origin = (text) => text.match(/vengo de(?: tu| su)? ([\p{L}]+)/iu)?.[1]?.toLowerCase() ?? 'directo';
const byChannel = (ids) =>
  [...ids].reduce((acc, ch) => ({ ...acc, [ch]: (acc[ch] ?? 0) + 1 }), {});

const leads = (await rows('leads', 'contact_id, channel, at')).filter((l) => isReal(l.contact_id));

const marks = (await rows('follow_ups', 'phone, reason, at')).filter((m) => isReal(m.phone));
const followUps = marks.filter((m) => m.reason === 'sent').length;
const bookedMarks = marks.filter((m) => m.reason === 'booked').length;
```

El resto del archivo (citas de Cal.com e impresión) se queda igual. Actualizar el comentario de arriba: `// Uso real de un cliente en los últimos N días, desde Postgres.`

- [ ] **Step 7: `client-check.ts`**

En `needed`, agregar `'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'`. Después del paso de Redis:

```ts
if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  await step('Supabase', async () => {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/contacts?select=client_id&limit=1`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!res.ok) throw new Error(`respondió ${res.status}: ¿se aplicó el esquema? (supabase/migrations)`);
    return 'esquema aplicado';
  });
}
```

- [ ] **Step 8: Tipos y frontera**

Run: `npx tsc --noEmit && npm run -s check:boundary && node core/store/db.ts`
Expected: sin errores; `db.ts self-check passed`.

- [ ] **Step 9: Supabase caído no tumba la conversación**

```bash
S=/private/tmp/claude-501/-Users-marcohernandez-quetzal/60bcd3fb-2a77-47f8-b1e9-05ce0e49745e/scratchpad
(SUPABASE_URL=http://127.0.0.1:9 nohup caffeinate -i npx next dev > $S/dev-down.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ | grep -q 200 && break; sleep 2; done
curl -s -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' \
  -d '{"sessionId":"eval-down-1","text":"Soy Ana, mi correo es ana.eval@ejemplo.com, quiero información"}'
grep -E "conversation log failed|lead save failed" $S/dev-down.log | head -2
pkill -f "next dev"
```

Expected: el `curl` regresa `{"text":"…"}` con respuesta normal (HTTP 200), y el log del server muestra `conversation log failed` y `lead save failed`. Llega el correo de aviso del lead a contacto@3dev.mx (avisar a Marco antes de correrlo; es un correo real).

- [ ] **Step 10: Suites contra Supabase**

```bash
(WHATSAPP_APP_SECRET=local nohup caffeinate -i npx next dev > $S/dev-3dev.log 2>&1 &)   # esperar el 200 como arriba
WHATSAPP_APP_SECRET=local npm run eval:3dev
pkill -f "next dev"
(set -a && . ./.env.demo-dental && set +a && CLIENT=demo-dental nohup caffeinate -i npx next dev > $S/dev-demo.log 2>&1 &)
node --env-file=.env.demo-dental clients/demo-dental/evals.ts
pkill -f "next dev"
```

Expected: `20/20 passed, 1 saltados` y `13/13 passed, 1 saltados`. Después:
`node --env-file=.env.local --input-type=module -e "import {db} from './core/store/db.ts'; const r = await db().from('contacts').select('contact_id', {count:'exact', head:true}).like('contact_id','eval-%'); console.log('restos eval:', r.count)"` → `restos eval: 0`. Si la Sheet del demo tiene el cepillo en 4, correr el demo con la semilla local (ver el plan del catálogo).

- [ ] **Step 11: Reporte**

Run: `node --env-file=.env.local scripts/report.mjs quetzal-3dev 30`
Expected: corre sin error y muestra ceros o casi (Postgres todavía no tiene la historia; llega en la Task 6).

- [ ] **Step 12: Commit**

```bash
git add core/store/session-store.ts app/api scripts/evals.ts scripts/report.mjs scripts/client-check.ts
git commit -m "feat: rutas, evals y reporte leen y escriben en Postgres"
```

---

### Task 4: Migración única Redis → Postgres

**Files:**
- Create: `scripts/migrate-redis.mjs`

**Interfaces:**
- Consumes (Task 2): `db`, `logEntryToMessages`, `leadToRow`.
- Produces: `node --env-file=.env.local scripts/migrate-redis.mjs <clientId>... [--dry-run] [--force]`.

- [ ] **Step 1: Escribir el script**

```js
// Copia única de Redis a Postgres, después del deploy que ya escribe en Postgres.
//   node --env-file=.env.local scripts/migrate-redis.mjs quetzal-3dev demo-dental [--dry-run] [--force]
// Se salta los eval-*. Las llaves de Redis no se tocan: vencen solas en 90 días.
import { Redis } from '@upstash/redis';
import { db, logEntryToMessages, leadToRow } from '../core/store/db.ts';

const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const dry = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const clients = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!clients.length) {
  console.error('Uso: scripts/migrate-redis.mjs <clientId>... [--dry-run] [--force]');
  process.exit(1);
}
const isEval = (id = '') => id.startsWith('eval');
const must = async (p) => { const { data, error, count } = await p; if (error) throw error; return count ?? data; };

async function scanAll(match) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await kv.scan(cursor, { match, count: 1000 });
    cursor = String(next);
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function insertChunks(table, rows, options) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await must(options ? db().from(table).upsert(chunk, options) : db().from(table).insert(chunk));
  }
}

for (const clientId of clients) {
  const turns = (await Promise.all((await scanAll(`log:${clientId}:*`)).map((k) => kv.lrange(k, 0, -1))))
    .flat()
    .filter((t) => !isEval(t.contactId))
    .sort((a, b) => a.at.localeCompare(b.at));

  // After the deploy, Postgres has this client's new traffic, so "has rows"
  // can't mean "already migrated". Rows older than Redis's newest turn can.
  if (!dry && !force) {
    const oldest = await must(
      db().from('messages').select('at').eq('client_id', clientId).not('contact_id', 'like', 'eval%').order('at').limit(1),
    );
    const newestRedis = turns.at(-1)?.at;
    if (oldest?.[0] && newestRedis && new Date(oldest[0].at) <= new Date(newestRedis)) {
      console.error(`${clientId}: Postgres ya tiene mensajes de antes del deploy; parece migrado. Usa --force para repetirlo.`);
      continue;
    }
  }

  const contacts = new Map();
  for (const t of turns) {
    const c = contacts.get(t.contactId);
    if (!c) {
      contacts.set(t.contactId, {
        client_id: clientId, contact_id: t.contactId, channel: t.channel,
        name: null, interest: null, left_contact: false, first_seen_at: t.at, last_seen_at: t.at,
      });
    } else c.last_seen_at = t.at;
  }

  const profilePrefix = `profile:${clientId}:`;
  for (const key of await scanAll(`${profilePrefix}*`)) {
    const contactId = key.slice(profilePrefix.length);
    if (isEval(contactId)) continue;
    const p = await kv.get(key);
    if (!p) continue;
    const c = contacts.get(contactId) ?? {
      client_id: clientId, contact_id: contactId, channel: 'whatsapp',
      first_seen_at: p.lastSeenAt, last_seen_at: p.lastSeenAt,
    };
    c.name = p.name ?? null;
    c.interest = p.interest ?? null;
    c.left_contact = !!p.leftContact;
    if (p.lastSeenAt > c.last_seen_at) c.last_seen_at = p.lastSeenAt;
    contacts.set(contactId, c);
  }

  const messages = turns.flatMap((t) => logEntryToMessages(clientId, { ...t, at: new Date(t.at) }));
  const leads = (await kv.lrange(`leads:${clientId}`, 0, -1)).filter((l) => !isEval(l.contactId)).map((l) => leadToRow(clientId, l));

  const followUps = [];
  for (const key of await scanAll(`followup:${clientId}:*`)) {
    const [reason, ttl] = await Promise.all([kv.get(key), kv.ttl(key)]);
    if (reason !== 'sent' && reason !== 'booked') continue;
    // The mark kept no date, but its 90-day TTL says when it was set.
    const at = new Date(Date.now() - (90 * 864e5 - ttl * 1000)).toISOString();
    followUps.push({ client_id: clientId, phone: key.split(':').at(-1), reason, at });
  }

  console.log(`${clientId}: ${contacts.size} contactos, ${turns.length} turnos (${messages.length} mensajes), ${leads.length} leads, ${followUps.length} seguimientos`);
  if (dry) continue;

  await insertChunks('contacts', [...contacts.values()], { onConflict: 'client_id,contact_id' });
  await insertChunks('messages', messages);
  await insertChunks('leads', leads);
  await insertChunks('follow_ups', followUps, { onConflict: 'client_id,phone', ignoreDuplicates: true });
  console.log(`${clientId}: copiado`);
}
```

Ruling (spec decía "se niega si el cliente ya tiene filas"): con el orden deploy → migración el cliente sí tendrá filas nuevas, así que la guarda contra doble corrida mira si Postgres ya tiene mensajes anteriores al último turno de Redis.

- [ ] **Step 2: Corrida en seco contra el Redis real**

Run: `node --env-file=.env.local scripts/migrate-redis.mjs quetzal-3dev demo-dental --dry-run`
Expected: una línea por cliente con cuentas mayores que cero para `quetzal-3dev` (contactos ≈ personas del reporte de 90 días; turnos ≈ mensajes). Ningún write.

- [ ] **Step 3: Comparar contra el reporte viejo (Redis)**

```bash
git show main:scripts/report.mjs > $S/report-redis.mjs
cp $S/report-redis.mjs ./report-redis.tmp.mjs && node --env-file=.env.local report-redis.tmp.mjs quetzal-3dev 90; rm report-redis.tmp.mjs
```

Expected: "Mensajes" del reporte viejo = turnos de la corrida en seco menos los de `REPORT_EXCLUDE` (el dry-run no excluye el número del dueño; el reporte sí). Anotar ambas cifras en el ledger.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-redis.mjs
git commit -m "feat: script de migración única de Redis a Postgres"
```

---

### Task 5: Documentación y build

**Files:**
- Modify: `CLAUDE.md` ("Evals de voz y conocimiento", "Ficha de contacto", "Seguimiento automático", "Registro de conversaciones", "Hoja de ruta")
- Modify: `docs/nuevo-cliente.md` (sección 5, Vercel)

- [ ] **Step 1: `CLAUDE.md`**

- "Registro de conversaciones": reemplazar el párrafo por:

```md
Cada turno se guarda en Postgres (Supabase; `core/store/db.ts`,
`createConversationLog`): un contacto en `contacts` y dos filas en
`messages` (`user`, `assistant`), con `client_id` = el `id` de la config.
Una sola base para todos los clientes. Los plazos del aviso de privacidad
los aplica la base: `purge_expired()` corre cada noche con `pg_cron`
(mensajes 12 meses, nombre e interés 90 días sin escribir, marcas de
seguimiento 90 días). El esquema vive en `supabase/migrations/` y se aplica
con `npx supabase db push --db-url` (la conexión directa está en
`POSTGRES_URL_NON_POOLING`, en Vercel). Redis solo guarda la sesión de 24 h
y el límite de mensajes. Pruebas contra la base real:
`scripts/check-purge.mjs` y `scripts/check-db.mjs`.
```

- "Ficha de contacto": cambiar "en `profile:<clientId>:<contactId>` (`createProfileStore`)" por "en `contacts` (`createProfileStore`, `core/store/db.ts`)", y "con 90 días de vida que se renuevan con cada mensaje" por "con 90 días de vida desde el último mensaje (`purge_expired()` la vacía)".
- "Seguimiento automático": cambiar "La marca `followup:<clientId>:<número>` (90 días)" por "La marca en `follow_ups` (90 días)".
- "Evals de voz y conocimiento": cambiar "Las entradas del log de conversaciones se quedan: al medir uso real, excluir los contactIds `eval-`." por "La limpieza borra también sus contactos y mensajes de Postgres; el reporte excluye `eval-*` de todos modos."
- "Hoja de ruta": cambiar la viñeta de **Postgres/Supabase** por: "**Postgres/Supabase** ya guarda conversaciones, leads, fichas y seguimientos (ver "Registro de conversaciones"). Falta pgvector para RAG."
- "Tool-calling": cambiar "las rutas lo guardan sin vencimiento en `leads:<clientId>` (`createLeadStore`, `core/store/session-store.ts`)" por "las rutas lo guardan sin vencimiento en `leads` (`createLeadStore`, `core/store/db.ts`)".

- [ ] **Step 2: `docs/nuevo-cliente.md`**

En la sección 5 (Vercel), agregar:

```md
- **Supabase:** conecta el proyecto nuevo a la base `quetzal` desde
  Vercel → Storage → la base → **Connect Project** (Production, Preview y
  Development, sin prefijo). Es una sola base para todos los clientes: el
  `id` de `assistant.config.ts` separa sus filas, así que debe ser único.
  `client-check` revisa que responda.
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `check:boundary` y `check:offer` pasan y `next build` termina. (Prueba también el foco 1: el build importa las rutas.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/nuevo-cliente.md docs/superpowers/specs/2026-10-18-postgres-supabase-design.md docs/superpowers/plans/2026-10-19-postgres-supabase.md
git commit -m "docs: Postgres en CLAUDE.md y en la guía de alta"
```

---

### Task 6: Corte en producción

**Files:** ninguno (operación).

- [ ] **Step 1: STOP — visto bueno de Marco para subir y desplegar**

Antes de las 16:00 UTC (cron de seguimiento). Con el visto bueno: merge fast-forward a `main` y `git push`.

- [ ] **Step 2: Confirmar el deploy**

Run: `npx -y vercel@latest ls 3dev-quetzal --prod 2>&1 | head -8` y lo mismo para `quetzal-demo-dental`.
Expected: el deploy más reciente de cada uno en `Ready`, con el commit del merge.

- [ ] **Step 3: Migrar**

Run: `node --env-file=.env.local scripts/migrate-redis.mjs quetzal-3dev demo-dental`
Expected: las mismas cuentas que la corrida en seco de la Task 4 (más lo que haya entrado a Redis entre ambas), y `copiado` por cliente.

- [ ] **Step 4: Comparar reportes**

Run: `node --env-file=.env.local scripts/report.mjs quetzal-3dev 30` y el reporte viejo de Redis (Task 4, Step 3) con 30 días.
Expected: mismas personas, mensajes, origen y leads. Seguimientos y citas iguales.

- [ ] **Step 5: Humo en producción**

```bash
curl -s -X POST https://quetzal.3dev.mx/api/chat -H 'Content-Type: application/json' -d '{"sessionId":"eval-smoke-pg","text":"¿Qué hace Quetzal?"}'
node --env-file=.env.local --input-type=module -e "import {db} from './core/store/db.ts'; const {data} = await db().from('messages').select('role').eq('client_id','quetzal-3dev').eq('contact_id','eval-smoke-pg'); console.log('mensajes del humo:', data.length); await db().from('contacts').delete().eq('client_id','quetzal-3dev').eq('contact_id','eval-smoke-pg');"
```

Expected: respuesta normal y `mensajes del humo: 2` (luego se borra).

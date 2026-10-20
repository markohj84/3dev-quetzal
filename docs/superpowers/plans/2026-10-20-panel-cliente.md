# Panel del cliente — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/panel` en el dominio de cada cliente: el dueño entra con un código por correo y ve Resumen, Conversaciones y Leads de su negocio, en solo lectura, con RLS como candado.

**Architecture:** Server Components de Next 15 leen Postgres con la sesión del usuario (`@supabase/ssr`, llave pública); políticas RLS de solo lectura atadas a `dashboard_users`. Un middleware refresca la sesión solo en `/panel/*`. Funciones puras en `app/panel/shape.ts`, consultas en `app/panel/data.ts`. Las citas salen de Cal.com con `scheduler.bookedPhones()`.

**Tech Stack:** Next.js 15.5 (App Router, server actions), React 19, `@supabase/ssr@0.12.7`, `@supabase/supabase-js`, Supabase Auth (OTP por correo), Postgres RLS.

**Spec:** `docs/superpowers/specs/2026-10-20-panel-cliente-design.md`

## Global Constraints

- El panel **nunca** usa `SUPABASE_SERVICE_ROLE_KEY`; solo `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` con la sesión del usuario. `service_role` solo en scripts locales (`panel-user.mjs`, checks).
- Políticas RLS solo `for select to authenticated`; ninguna de escritura.
- `signInWithOtp` siempre con `shouldCreateUser: false`.
- El middleware solo corre en `matcher: ['/panel/:path*']`.
- Una sola dependencia nueva: `@supabase/ssr@0.12.7` (publicada 2026-09-08).
- Ningún archivo bajo `core/` nombra a un cliente; el panel vive en `app/panel/`.
- Texto de cara al usuario en español; fechas en `config.scheduling.timeZone` y `config.locale`.
- Correos de prueba con dominio `3dev.test` y prefijo `eval-panel`; filas de prueba con `contact_id` que empieza con `eval`.
- No correr `npm run build` con el dev server encendido. No subir ni desplegar sin Marco.

## Review Focus

1. **Cookie de sesión vencida, corrupta o de otro proyecto**: `/panel` redirige a `/panel/entrar`, nunca un 500. → Task 5, `check-panel-pages` (cookie basura).
2. **`contactId` inexistente o con caracteres raros en la URL**: "Conversación no encontrada", no un error. → Task 5, `check-panel-pages`.
3. **Mensajes cerca de medianoche**: la hora y el separador de día van en la zona del cliente, no en UTC. → Task 3, autoprueba `formatWhen`/`dayKey`.
4. **Correo sin acceso y correo con acceso**: la pantalla dice lo mismo ("Si tu correo tiene acceso…"). → Task 3, autoprueba `loginMessage`; Task 4 usa solo esa función.
5. **Un usuario de otro cliente** abre este panel: "No tienes acceso a este panel", y aunque arme la consulta a mano la base no le da filas. → Task 1 (`check-panel-rls`) y Task 5 (`check-panel-pages`, usuario sin acceso).

---

## Mapa de archivos

| Archivo | Cambio | Responsabilidad |
|---|---|---|
| `supabase/migrations/20261021000000_panel.sql` | Crear | `dashboard_users` + políticas de lectura |
| `scripts/check-panel-rls.mjs` | Crear | RLS contra la base real |
| `scripts/panel-user.mjs` | Crear | Alta, baja y lista de accesos |
| `app/panel/shape.ts` | Crear | Funciones puras + autoprueba |
| `app/panel/supabase.ts` | Crear | Cliente de `@supabase/ssr` para Server Components y actions |
| `middleware.ts` | Crear | Refresca la sesión en `/panel/*` |
| `app/panel/panel.css` | Crear | Estilos |
| `app/panel/entrar/page.tsx` | Crear | Login en dos pasos |
| `app/panel/salir/route.ts` | Crear | Cierra sesión |
| `app/panel/(app)/layout.tsx` | Crear | Sesión, acceso, encabezado |
| `app/panel/nav.tsx` | Crear | Pestañas + periodo |
| `app/panel/data.ts` | Crear | Consultas |
| `app/panel/(app)/page.tsx`, `conversaciones/page.tsx`, `conversaciones/[contactId]/page.tsx`, `leads/page.tsx`, `error.tsx` | Crear | Pantallas |
| `scripts/check-panel-pages.mjs` | Crear | Páginas contra el dev server con sesión real |
| `CLAUDE.md`, `docs/nuevo-cliente.md`, `.env.local`, `.env.demo-dental` | Modificar | Documentación y variables locales |

---

### Task 1: Accesos y políticas de lectura

**Files:**
- Create: `supabase/migrations/20261021000000_panel.sql`
- Create: `scripts/check-panel-rls.mjs`
- Modify: `.env.local`, `.env.demo-dental` (variables públicas)

**Interfaces:**
- Consumes: tablas de `20261019000000_init.sql`.
- Produces: tabla `dashboard_users (user_id uuid, client_id text)`; políticas `"panel lee su cliente"` en `contacts`, `messages`, `leads`, `follow_ups`.

- [ ] **Step 1: Variables públicas locales**

```bash
T=$(mktemp /private/tmp/claude-501/-Users-marcohernandez-quetzal/60bcd3fb-2a77-47f8-b1e9-05ce0e49745e/scratchpad/env.XXXXXX)
npx -y vercel@latest env pull "$T" --environment=production --yes >/dev/null 2>&1
for f in .env.local .env.demo-dental; do
  grep -q '^NEXT_PUBLIC_SUPABASE_URL=' $f || grep -E '^NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY)=' "$T" | sed -E 's/^([A-Z_]+)="(.*)"$/\1=\2/' >> $f
done
rm -f "$T"
grep -oE '^NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY)=' .env.local .env.demo-dental
```

Expected: las dos variables en los dos archivos, sin comillas.

- [ ] **Step 2: Prueba de RLS (falla: no existe `dashboard_users`)**

Crear `scripts/check-panel-rls.mjs`:

```js
// RLS del panel contra la base real: un usuario solo lee su cliente y no escribe.
//   node --env-file=.env.local scripts/check-panel-rls.mjs
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anonClient = () => createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const A = 'eval-a', B = 'eval-b';
const emailA = 'eval-panel-a@3dev.test', emailB = 'eval-panel-b@3dev.test';

async function userId(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email)?.id;
}
async function cleanup() {
  for (const email of [emailA, emailB]) {
    const id = await userId(email);
    if (id) await admin.auth.admin.deleteUser(id);
  }
  for (const c of [A, B]) {
    await must(admin.from('leads').delete().eq('client_id', c));
    await must(admin.from('follow_ups').delete().eq('client_id', c));
    await must(admin.from('contacts').delete().eq('client_id', c));
  }
}
/** A session without sending an email: the admin API hands back the same OTP the email would carry. */
async function signedIn(email) {
  const link = await must(admin.auth.admin.generateLink({ type: 'magiclink', email }));
  const sb = anonClient();
  await must(sb.auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' }));
  return sb;
}

await cleanup();
try {
  for (const [email, client] of [[emailA, A], [emailB, B]]) {
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
    await must(admin.from('dashboard_users').insert({ user_id: data.user.id, client_id: client }));
    await must(admin.from('contacts').insert({ client_id: client, contact_id: `eval-${client}`, channel: 'web', left_contact: false }));
    await must(admin.from('messages').insert({ client_id: client, contact_id: `eval-${client}`, role: 'user', content: `hola desde ${client}` }));
    await must(admin.from('leads').insert({ client_id: client, contact_id: `eval-${client}`, channel: 'web', nombre: client, contacto: 'x@3dev.test' }));
  }

  const a = await signedIn(emailA);
  for (const table of ['contacts', 'messages', 'leads']) {
    const rows = await must(a.from(table).select('client_id').in('client_id', [A, B]));
    assert.deepEqual([...new Set(rows.map((r) => r.client_id))], [A], `${table}: A solo ve su cliente`);
  }
  const access = await must(a.from('dashboard_users').select('client_id'));
  assert.deepEqual(access.map((r) => r.client_id), [A], 'A solo ve su propio acceso');

  const ins = await a.from('leads').insert({ client_id: A, contact_id: 'eval-x', channel: 'web', nombre: 'x', contacto: 'x' });
  assert.ok(ins.error, 'A no puede insertar');
  const upd = await a.from('contacts').update({ name: 'hack' }).eq('client_id', A).select();
  assert.ok(upd.error || upd.data.length === 0, 'A no puede actualizar');
  const del = await a.from('messages').delete().eq('client_id', A).select();
  assert.ok(del.error || del.data.length === 0, 'A no puede borrar');
  const grant = await a.from('dashboard_users').insert({ user_id: (await a.auth.getUser()).data.user.id, client_id: B });
  assert.ok(grant.error, 'A no se puede dar acceso a otro cliente');

  const anon = await must(anonClient().from('messages').select('client_id').in('client_id', [A, B]));
  assert.equal(anon.length, 0, 'sin sesión no se ve nada');
  console.log('check-panel-rls: passed');
} finally {
  await cleanup();
}
```

Run: `node --env-file=.env.local scripts/check-panel-rls.mjs`
Expected: FAIL con `Could not find the table 'public.dashboard_users'`.

- [ ] **Step 3: Migración**

Crear `supabase/migrations/20261021000000_panel.sql`:

```sql
-- Who may read which client's data in the panel. Rows are added by 3dev
-- (scripts/panel-user.mjs, with service_role); nobody grants themselves access.
create table dashboard_users (
  user_id   uuid not null references auth.users on delete cascade,
  client_id text not null,
  primary key (user_id, client_id)
);
alter table dashboard_users enable row level security;
create policy "ve sus accesos" on dashboard_users
  for select to authenticated using (user_id = (select auth.uid()));

-- Read-only, and only the clients listed for this user. The (select auth.uid())
-- form is evaluated once per query instead of once per row.
create policy "panel lee su cliente" on contacts for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel lee su cliente" on messages for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel lee su cliente" on leads for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel lee su cliente" on follow_ups for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
```

Aplicar:

```bash
T=$(mktemp /private/tmp/claude-501/-Users-marcohernandez-quetzal/60bcd3fb-2a77-47f8-b1e9-05ce0e49745e/scratchpad/env.XXXXXX)
npx -y vercel@latest env pull "$T" --environment=production --yes >/dev/null 2>&1
DBURL=$(grep '^POSTGRES_URL_NON_POOLING=' "$T" | cut -d= -f2- | tr -d '"'); rm -f "$T"
npx -y supabase@2.121.0 db push --db-url "$DBURL" --yes 2>&1 | sed -E 's#postgres(ql)?://[^ ]+#<db-url>#g' | tail -3
```

Expected: `Applying migration 20261021000000_panel.sql... Finished supabase db push.`

- [ ] **Step 4: Ver la prueba pasar**

Run: `node --env-file=.env.local scripts/check-panel-rls.mjs`
Expected: `check-panel-rls: passed`. Si `verifyOtp` con `type: 'email'` rechaza el `email_otp` de un magiclink, usar `type: 'magiclink'` y anotar el Ruling (el panel usa `type: 'email'` porque el correo lleva un código de signInWithOtp).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261021000000_panel.sql scripts/check-panel-rls.mjs
git commit -m "feat: accesos del panel y políticas de solo lectura por cliente"
```

---

### Task 2: Alta de accesos (`scripts/panel-user.mjs`)

**Files:**
- Create: `scripts/panel-user.mjs`

**Interfaces:**
- Consumes: `dashboard_users` (Task 1).
- Produces: `node --env-file=.env.local scripts/panel-user.mjs add|remove <correo> <clientId>` y `list <clientId>`.

- [ ] **Step 1: Escribir el script**

```js
// Accesos al panel. Corre solo en la máquina de 3dev (usa service_role).
//   node --env-file=.env.local scripts/panel-user.mjs add <correo> <clientId>
//   node --env-file=.env.local scripts/panel-user.mjs remove <correo> <clientId>
//   node --env-file=.env.local scripts/panel-user.mjs list <clientId>
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [cmd, a, b] = process.argv.slice(2);
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };

async function allUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}
const byEmail = async (email) => (await allUsers()).find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (cmd === 'add' && a && b) {
  const email = a.trim().toLowerCase();
  let user = await byEmail(email);
  if (!user) {
    // Confirmed up front: the first thing they get is the login code, not a confirmation email.
    user = (await must(admin.auth.admin.createUser({ email, email_confirm: true }))).user;
  }
  await must(admin.from('dashboard_users').upsert({ user_id: user.id, client_id: b }, { onConflict: 'user_id,client_id', ignoreDuplicates: true }));
  console.log(`${email} tiene acceso al panel de ${b}`);
} else if (cmd === 'remove' && a && b) {
  const user = await byEmail(a);
  if (!user) {
    console.log(`${a} no existe`);
  } else {
    await must(admin.from('dashboard_users').delete().eq('user_id', user.id).eq('client_id', b));
    const left = await must(admin.from('dashboard_users').select('client_id').eq('user_id', user.id));
    if (!left.length) await must(admin.auth.admin.deleteUser(user.id));
    console.log(`${a} ya no tiene acceso a ${b}${left.length ? '' : ' (usuario borrado: no le quedaban clientes)'}`);
  }
} else if (cmd === 'list' && a) {
  const rows = await must(admin.from('dashboard_users').select('user_id').eq('client_id', a));
  const users = await allUsers();
  const emails = rows.map((r) => users.find((u) => u.id === r.user_id)?.email ?? r.user_id);
  console.log(emails.length ? emails.join('\n') : `Nadie tiene acceso a ${a}`);
} else {
  console.error('Uso: panel-user.mjs add|remove <correo> <clientId> · panel-user.mjs list <clientId>');
  process.exit(1);
}
```

- [ ] **Step 2: Probarlo de ida y vuelta**

```bash
E=--env-file=.env.local
node $E scripts/panel-user.mjs list eval-c
node $E scripts/panel-user.mjs add Eval-Panel-C@3dev.test eval-c
node $E scripts/panel-user.mjs add eval-panel-c@3dev.test eval-c
node $E scripts/panel-user.mjs list eval-c
node $E scripts/panel-user.mjs remove eval-panel-c@3dev.test eval-c
node $E scripts/panel-user.mjs list eval-c
```

Expected, en orden: `Nadie tiene acceso a eval-c`; `eval-panel-c@3dev.test tiene acceso al panel de eval-c` (dos veces, la segunda sin duplicar); `eval-panel-c@3dev.test`; `… ya no tiene acceso a eval-c (usuario borrado: no le quedaban clientes)`; `Nadie tiene acceso a eval-c`.

- [ ] **Step 3: Commit**

```bash
git add scripts/panel-user.mjs
git commit -m "feat: script para dar y quitar acceso al panel"
```

---

### Task 3: Funciones puras (`app/panel/shape.ts`)

**Files:**
- Create: `app/panel/shape.ts`

**Interfaces:**
- Consumes: `leadPhone`, `metaPhone` de `core/followup.ts`.
- Produces:
  - Tipos `MessageLite { contact_id; role: 'user'|'assistant'; content; at }`, `ContactLite { contact_id; channel; name: string|null; interest: string|null; left_contact: boolean }`, `LeadLite { contact_id; channel; nombre; contacto; necesidad: string|null; at }`, `ConversationRow { contactId; channel; name; lastAt; lastText; count; leftData; booked }`.
  - `parseDays(raw?: string): 7|30|90`
  - `displayName(contactId, channel, contact?, lead?): string`
  - `contactPhone(contactId, channel, lead?, countryCode?): string|null`
  - `summarizeConversations(messages, contacts: Map<string, ContactLite>, leads: Map<string, LeadLite>, booked: Set<string>|null, countryCode?): ConversationRow[]`
  - `dayKey(iso, timeZone): string` (YYYY-MM-DD en la zona)
  - `formatWhen(iso, locale, timeZone, now: Date): string`
  - `contactLink(contacto, countryCode?): { href: string; label: string } | null`
  - `loginMessage(state?: string): string | null`

- [ ] **Step 1: Autoprueba (falla: no hay implementación)**

Crear `app/panel/shape.ts` con stubs que regresan valores vacíos (`return 7`, `return ''`, `return null`, `return []`) para cada función del bloque Produces, y este bloque al final:

```ts
// Self-check: `node app/panel/shape.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const TZ = 'America/Mexico_City';
  assert.equal(parseDays(undefined), 7);
  assert.equal(parseDays('30'), 30);
  assert.equal(parseDays('365'), 7, 'solo 7, 30 o 90');

  const lead: LeadLite = { contact_id: 's1', channel: 'web', nombre: 'Luis Ramos', contacto: '222 555 0101', necesidad: 'ortodoncia', at: '2026-10-20T15:00:00Z' };
  assert.equal(displayName('5212225344440', 'whatsapp', { contact_id: '5212225344440', channel: 'whatsapp', name: 'Ana', interest: null, left_contact: false }), 'Ana');
  assert.equal(displayName('s1', 'web', undefined, lead), 'Luis Ramos', 'sin nombre en el contacto, el del lead');
  assert.equal(displayName('5212225344440', 'whatsapp'), '+5212225344440', 'en WhatsApp, el número completo');
  assert.equal(displayName('s9', 'web'), 'Visitante web');

  assert.equal(contactPhone('5212225344440', 'whatsapp'), '522225344440');
  assert.equal(contactPhone('s1', 'web', lead, '52'), '522225550101');
  assert.equal(contactPhone('s9', 'web'), null);

  const msgs: MessageLite[] = [
    { contact_id: 's1', role: 'user', content: '¿Precio de alineadores?', at: '2026-10-19T16:00:00Z' },
    { contact_id: 's1', role: 'assistant', content: 'Se cotizan en la valoración.', at: '2026-10-19T16:00:00Z' },
    { contact_id: '5212225344440', role: 'user', content: 'Hola', at: '2026-10-20T16:40:00Z' },
    { contact_id: '5212225344440', role: 'assistant', content: 'Listo, quedó agendada el jueves 22 a las 10:00. Te esperamos en la clínica para tu limpieza.', at: '2026-10-20T16:42:00Z' },
  ];
  const contacts = new Map<string, ContactLite>([
    ['5212225344440', { contact_id: '5212225344440', channel: 'whatsapp', name: 'Ana López', interest: 'limpieza', left_contact: true }],
    ['s1', { contact_id: 's1', channel: 'web', name: null, interest: null, left_contact: false }],
  ]);
  const rows = summarizeConversations(msgs, contacts, new Map([['s1', lead]]), new Set(['522225344440']), '52');
  assert.deepEqual(rows.map((r) => r.contactId), ['5212225344440', 's1'], 'la más reciente arriba');
  assert.equal(rows[0].name, 'Ana López');
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].leftData, true);
  assert.equal(rows[0].booked, true, 'el teléfono de WhatsApp está entre los que agendaron');
  assert.ok(rows[0].lastText.length <= 80 && rows[0].lastText.endsWith('…'), 'texto recortado');
  assert.equal(rows[1].name, 'Luis Ramos');
  assert.equal(rows[1].leftData, true, 'tener un lead cuenta como dejó datos');
  assert.equal(rows[1].booked, false);
  assert.equal(summarizeConversations(msgs, contacts, new Map(), null)[0].booked, false, 'sin Cal.com no hay etiqueta agendó');

  // 05:30 UTC del 21 es 23:30 del 20 en México.
  assert.equal(dayKey('2026-10-21T05:30:00Z', TZ), '2026-10-20');
  const now = new Date('2026-10-21T18:00:00Z');
  assert.match(formatWhen('2026-10-21T16:42:00Z', 'es-MX', TZ, now), /^hoy 10:42/);
  assert.match(formatWhen('2026-10-21T05:30:00Z', 'es-MX', TZ, now), /^ayer/, 'medianoche se decide en la zona del cliente');
  assert.match(formatWhen('2026-10-02T16:00:00Z', 'es-MX', TZ, now), /2 oct/);

  assert.deepEqual(contactLink('luis@correo.mx'), { href: 'mailto:luis@correo.mx', label: 'luis@correo.mx' });
  assert.deepEqual(contactLink('222 555 0101', '52'), { href: 'https://wa.me/522225550101', label: '222 555 0101' });
  assert.equal(contactLink('mañana en la tarde'), null);

  assert.equal(loginMessage(undefined), null);
  assert.equal(loginMessage('enviado'), 'Si tu correo tiene acceso, te llegó un código. Escríbelo aquí.');
  assert.equal(loginMessage('codigo'), 'Código incorrecto o vencido.');
  assert.equal(loginMessage('espera'), 'Espera un minuto y vuelve a intentar.');
  assert.equal(loginMessage('correo'), 'Escribe un correo válido.');

  console.log('shape.ts self-check passed');
}
```

Encabezado del archivo: `import assert from 'node:assert';` y `import { leadPhone, metaPhone } from '../../core/followup.ts';`.

Run: `node app/panel/shape.ts`
Expected: FAIL con `AssertionError` en `parseDays('30')`.

- [ ] **Step 2: Implementar**

Reemplazar los stubs:

```ts
export interface MessageLite { contact_id: string; role: 'user' | 'assistant'; content: string; at: string }
export interface ContactLite { contact_id: string; channel: string; name: string | null; interest: string | null; left_contact: boolean }
export interface LeadLite { contact_id: string; channel: string; nombre: string; contacto: string; necesidad: string | null; at: string }
export interface ConversationRow {
  contactId: string;
  channel: string;
  name: string;
  lastAt: string;
  lastText: string;
  count: number;
  leftData: boolean;
  booked: boolean;
}

export function parseDays(raw?: string): 7 | 30 | 90 {
  return raw === '30' ? 30 : raw === '90' ? 90 : 7;
}

/** What the person told us beats the channel; a WhatsApp number is still someone to call back. */
export function displayName(contactId: string, channel: string, contact?: ContactLite, lead?: LeadLite): string {
  return contact?.name || lead?.nombre || (channel === 'whatsapp' ? `+${contactId}` : 'Visitante web');
}

/** The number Cal.com bookings are compared against, in Meta's format. */
export function contactPhone(contactId: string, channel: string, lead?: LeadLite, countryCode?: string): string | null {
  if (channel === 'whatsapp') return /^\d{10,15}$/.test(contactId) ? metaPhone(contactId) : null;
  return lead ? leadPhone({ nombre: lead.nombre, contacto: lead.contacto, channel: 'web', contactId, at: lead.at }, countryCode) : null;
}

const PREVIEW = 80;

export function summarizeConversations(
  messages: MessageLite[],
  contacts: Map<string, ContactLite>,
  leads: Map<string, LeadLite>,
  booked: Set<string> | null,
  countryCode?: string,
): ConversationRow[] {
  const byContact = new Map<string, MessageLite[]>();
  for (const m of messages) byContact.set(m.contact_id, [...(byContact.get(m.contact_id) ?? []), m]);
  const rows = [...byContact].map(([contactId, list]) => {
    const contact = contacts.get(contactId);
    const lead = leads.get(contactId);
    const channel = contact?.channel ?? lead?.channel ?? 'web';
    const last = list.at(-1)!;
    const phone = booked ? contactPhone(contactId, channel, lead, countryCode) : null;
    return {
      contactId,
      channel,
      name: displayName(contactId, channel, contact, lead),
      lastAt: last.at,
      lastText: last.content.length > PREVIEW ? `${last.content.slice(0, PREVIEW - 1).trimEnd()}…` : last.content,
      count: list.length,
      leftData: !!lead || !!contact?.left_contact,
      booked: !!(phone && booked?.has(phone)),
    };
  });
  return rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** "hoy 10:42", "ayer 23:30", "2 oct 10:00": the owner's clock, not the server's. */
export function formatWhen(iso: string, locale: string, timeZone: string, now: Date): string {
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const day = dayKey(iso, timeZone);
  if (day === dayKey(now.toISOString(), timeZone)) return `hoy ${time}`;
  if (day === dayKey(new Date(now.getTime() - 864e5).toISOString(), timeZone)) return `ayer ${time}`;
  const date = new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'short' }).format(new Date(iso)).replace('.', '');
  return `${date} ${time}`;
}

export function contactLink(contacto: string, countryCode?: string): { href: string; label: string } | null {
  const text = contacto.trim();
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(text)) return { href: `mailto:${text}`, label: text };
  const phone = leadPhone({ nombre: '', contacto: text, channel: 'web', contactId: '', at: '' }, countryCode);
  return phone ? { href: `https://wa.me/${phone}`, label: text } : null;
}

/** One message for "sent" whether or not the email has access: the screen must not reveal who does. */
export function loginMessage(state?: string): string | null {
  switch (state) {
    case 'enviado': return 'Si tu correo tiene acceso, te llegó un código. Escríbelo aquí.';
    case 'codigo': return 'Código incorrecto o vencido.';
    case 'espera': return 'Espera un minuto y vuelve a intentar.';
    case 'correo': return 'Escribe un correo válido.';
    default: return null;
  }
}
```

- [ ] **Step 3: Ver la autoprueba pasar**

Run: `node app/panel/shape.ts && npx tsc --noEmit`
Expected: `shape.ts self-check passed` y sin errores. Si `formatWhen` del 2 de octubre sale como `2 de oct`, ajustar el regex de la prueba a `/2( de)? oct/` y anotar el Ruling (formato de `Intl` en es-MX).

- [ ] **Step 4: Commit**

```bash
git add app/panel/shape.ts
git commit -m "feat: funciones puras del panel con autoprueba"
```

---

### Task 4: Sesión: cliente, middleware, entrar, salir y layout

**Files:**
- Create: `app/panel/supabase.ts`, `middleware.ts`, `app/panel/panel.css`, `app/panel/entrar/page.tsx`, `app/panel/salir/route.ts`, `app/panel/(app)/layout.tsx`, `app/panel/nav.tsx`
- Modify: `package.json` (`@supabase/ssr`)

**Interfaces:**
- Consumes: `loginMessage` (Task 3), `getAssistant` (`app/assistant.ts`), `dashboard_users` (Task 1).
- Produces: `createPanelClient(): Promise<SupabaseClient>`; `<Nav active="resumen"|"conversaciones"|"leads" days={7|30|90} />`.

- [ ] **Step 1: Dependencia**

Run: `npm install @supabase/ssr@0.12.7`

- [ ] **Step 2: Cliente para Server Components y actions — `app/panel/supabase.ts`**

```ts
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/** One per render, never shared: the session is this request's cookies. */
export async function createPanelClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components can't write cookies; the middleware already refreshed them.
        }
      },
    },
  });
}
```

- [ ] **Step 3: Middleware — `middleware.ts` (raíz del repo)**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Refreshes an expiring panel session and writes it back to the response.
 * Only /panel: the chat API, the widget and the webhooks never see it.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        // Responses that set auth cookies must never be cached for someone else.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value as string);
      },
    },
  });
  await sb.auth.getUser();
  return response;
}

export const config = { matcher: ['/panel/:path*'] };
```

- [ ] **Step 4: Estilos — `app/panel/panel.css`**

```css
.panel {
  --ink: #1d2420; --muted: #6b746f; --line: #e6ebe8; --soft: #f3f6f4; --accent: #2d6a4f;
  max-width: 760px; margin: 0 auto; padding: 16px; color: var(--ink);
  font: 15px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.panel a { color: var(--accent); text-decoration: none; }
.panel h1 { font-size: 18px; margin: 0; }
.panel .sub { color: var(--muted); font-size: 13px; }
.panel header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.panel nav.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 12px; overflow-x: auto; }
.panel nav.tabs a { padding: 8px 10px; color: var(--muted); white-space: nowrap; }
.panel nav.tabs a[aria-current='page'] { color: var(--ink); font-weight: 600; border-bottom: 2px solid var(--accent); }
.panel .period { display: flex; gap: 6px; font-size: 13px; margin-bottom: 12px; }
.panel .period a { padding: 2px 8px; border-radius: 999px; background: var(--soft); color: var(--muted); }
.panel .period a[aria-current='true'] { background: var(--accent); color: #fff; }
.panel .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px; }
@media (min-width: 640px) { .panel .stats { grid-template-columns: repeat(4, 1fr); } }
.panel .stat { background: var(--soft); border-radius: 10px; padding: 10px 12px; }
.panel .stat b { display: block; font-size: 22px; }
.panel .stat span { color: var(--muted); font-size: 12px; }
.panel ul.rows { list-style: none; margin: 0; padding: 0; }
.panel ul.rows li { border-top: 1px solid var(--line); padding: 10px 0; }
.panel .row-top { display: flex; justify-content: space-between; gap: 8px; }
.panel .when { color: var(--muted); font-size: 12px; white-space: nowrap; }
.panel .tags { font-size: 12px; color: var(--muted); }
.panel .tags .on { color: var(--accent); }
.panel .preview { color: var(--muted); font-size: 14px; }
.panel .bubbles { display: flex; flex-direction: column; gap: 6px; }
.panel .bubble { max-width: 80%; padding: 8px 11px; border-radius: 12px; white-space: pre-wrap; }
.panel .bubble.user { align-self: flex-start; background: var(--soft); }
.panel .bubble.assistant { align-self: flex-end; background: var(--accent); color: #fff; }
.panel .day { align-self: center; color: var(--muted); font-size: 12px; margin: 8px 0 2px; }
.panel form { display: flex; flex-direction: column; gap: 10px; max-width: 360px; }
.panel input { font: inherit; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; }
.panel button { font: inherit; padding: 10px 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
.panel .notice { background: var(--soft); border-radius: 8px; padding: 10px 12px; font-size: 14px; }
.panel .pager { display: flex; justify-content: space-between; margin-top: 12px; font-size: 14px; }
```

- [ ] **Step 5: Entrar — `app/panel/entrar/page.tsx`**

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAssistant } from '../../assistant';
import { createPanelClient } from '../supabase';
import { loginMessage } from '../shape';
import '../panel.css';

export const metadata: Metadata = { title: 'Entrar al panel', robots: { index: false } };

async function sendCode(form: FormData) {
  'use server';
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) redirect('/panel/entrar?estado=correo');
  const sb = await createPanelClient();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  // An email without access errors here too (no signups); the screen says "sent" either way.
  if (error?.status === 429) redirect('/panel/entrar?estado=espera');
  redirect(`/panel/entrar?correo=${encodeURIComponent(email)}&estado=enviado`);
}

async function verifyCode(form: FormData) {
  'use server';
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const token = String(form.get('token') ?? '').replace(/\D/g, '');
  const sb = await createPanelClient();
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) redirect(`/panel/entrar?correo=${encodeURIComponent(email)}&estado=${error.status === 429 ? 'espera' : 'codigo'}`);
  redirect('/panel');
}

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ correo?: string; estado?: string }> }) {
  const { correo, estado } = await searchParams;
  const { config } = await getAssistant();
  const message = loginMessage(estado);
  return (
    <main className="panel">
      <header>
        <div>
          <h1>{config.organization}</h1>
          <div className="sub">Panel de {config.name}</div>
        </div>
      </header>
      {message && <p className="notice">{message}</p>}
      {correo ? (
        <form action={verifyCode}>
          <input type="hidden" name="email" value={correo} />
          <label htmlFor="token">Código que te llegó a {correo}</label>
          <input id="token" name="token" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus />
          <button type="submit">Entrar</button>
          <a href="/panel/entrar">Usar otro correo</a>
        </form>
      ) : (
        <form action={sendCode}>
          <label htmlFor="email">Tu correo</label>
          <input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          <button type="submit">Enviarme un código</button>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Salir — `app/panel/salir/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { createPanelClient } from '../supabase';

export async function POST(request: Request) {
  const sb = await createPanelClient();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL('/panel/entrar', request.url), { status: 303 });
}
```

- [ ] **Step 7: Pestañas y periodo — `app/panel/nav.tsx`**

```tsx
type Tab = 'resumen' | 'conversaciones' | 'leads';
const TABS: [Tab, string, string][] = [
  ['resumen', 'Resumen', '/panel'],
  ['conversaciones', 'Conversaciones', '/panel/conversaciones'],
  ['leads', 'Leads', '/panel/leads'],
];

export function Nav({ active, days }: { active: Tab; days: 7 | 30 | 90 }) {
  const path = TABS.find(([id]) => id === active)![2];
  return (
    <>
      <nav className="tabs">
        {TABS.map(([id, label, href]) => (
          <a key={id} href={`${href}?dias=${days}`} aria-current={id === active ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <div className="period">
        {[7, 30, 90].map((d) => (
          <a key={d} href={`${path}?dias=${d}`} aria-current={d === days ? 'true' : undefined}>{d} días</a>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 8: Layout protegido — `app/panel/(app)/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAssistant } from '../../assistant';
import { createPanelClient } from '../supabase';
import '../panel.css';

export const metadata: Metadata = { title: 'Panel', robots: { index: false } };
// Per-user data: never cached, never prerendered.
export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { config } = await getAssistant();
  const sb = await createPanelClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/panel/entrar');

  // RLS only returns this user's own rows: no row here means no access to this client.
  const { data: access } = await sb.from('dashboard_users').select('client_id').eq('client_id', config.id).maybeSingle();

  return (
    <main className="panel">
      <header>
        <div>
          <h1>{config.organization}</h1>
          <div className="sub">Panel de {config.name} · {user.email}</div>
        </div>
        <form action="/panel/salir" method="post"><button type="submit">Salir</button></form>
      </header>
      {access ? children : <p className="notice">No tienes acceso a este panel.</p>}
    </main>
  );
}
```

- [ ] **Step 9: Verificar**

Run: `npx tsc --noEmit && npm run -s check:boundary`
Expected: sin errores.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json app/panel/supabase.ts middleware.ts app/panel/panel.css app/panel/entrar app/panel/salir app/panel/nav.tsx "app/panel/(app)/layout.tsx"
git commit -m "feat: sesión del panel con código por correo"
```

---

### Task 5: Consultas y pantallas

**Files:**
- Create: `app/panel/data.ts`, `app/panel/(app)/page.tsx`, `app/panel/(app)/conversaciones/page.tsx`, `app/panel/(app)/conversaciones/[contactId]/page.tsx`, `app/panel/(app)/leads/page.tsx`, `app/panel/(app)/error.tsx`
- Create: `scripts/check-panel-pages.mjs`

**Interfaces:**
- Consumes: Task 3 (`summarizeConversations`, `displayName`, `formatWhen`, `dayKey`, `contactLink`, `parseDays`, tipos), Task 4 (`createPanelClient`, `Nav`), `selectAll` (`core/store/db.ts`), `getAssistant`, `metaPhone`.
- Produces: `loadSummary`, `loadConversations`, `loadConversation`, `loadLeads`.

- [ ] **Step 1: Prueba de páginas (falla: no hay páginas)**

Crear `scripts/check-panel-pages.mjs`:

```js
// Páginas del panel contra el dev server, con una sesión real y sin mandar correos.
//   CLIENT=demo-dental npm run dev                        # otra terminal
//   node --env-file=.env.demo-dental scripts/check-panel-pages.mjs demo-dental
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const [clientId] = process.argv.slice(2);
const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const OWNER = 'eval-panel-owner@3dev.test', STRANGER = 'eval-panel-stranger@3dev.test';
const WA = 'eval-panel-wa', WEB = 'eval-panel-web';

async function userId(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email)?.id;
}
async function cleanup() {
  for (const email of [OWNER, STRANGER]) { const id = await userId(email); if (id) await admin.auth.admin.deleteUser(id); }
  await must(admin.from('leads').delete().eq('client_id', clientId).in('contact_id', [WA, WEB]));
  await must(admin.from('contacts').delete().eq('client_id', clientId).in('contact_id', [WA, WEB]));
}
/** The exact cookies @supabase/ssr would set after typing the code, built offline. */
async function sessionCookie(email) {
  const jar = new Map();
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const link = await must(admin.auth.admin.generateLink({ type: 'magiclink', email }));
  await must(sb.auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' }));
  await new Promise((r) => setTimeout(r, 50));
  return [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
}
const get = (path, cookie) => fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });

await cleanup();
try {
  const owner = (await must(admin.auth.admin.createUser({ email: OWNER, email_confirm: true }))).user;
  await must(admin.auth.admin.createUser({ email: STRANGER, email_confirm: true }));
  await must(admin.from('dashboard_users').insert({ user_id: owner.id, client_id: clientId }));
  const now = Date.now();
  const at = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
  await must(admin.from('contacts').insert([
    { client_id: clientId, contact_id: WA, channel: 'whatsapp', name: 'Ana Panel', interest: 'limpieza', left_contact: true, last_seen_at: at(5) },
    { client_id: clientId, contact_id: WEB, channel: 'web', name: null, interest: null, left_contact: false, last_seen_at: at(60) },
  ]));
  await must(admin.from('messages').insert([
    { client_id: clientId, contact_id: WA, role: 'user', content: 'Quiero una limpieza el jueves', at: at(6) },
    { client_id: clientId, contact_id: WA, role: 'assistant', content: 'Con gusto, ¿a qué hora?', at: at(5) },
    { client_id: clientId, contact_id: WEB, role: 'user', content: '¿Cuánto cuesta la valoración?', at: at(60) },
  ]));
  await must(admin.from('leads').insert({ client_id: clientId, contact_id: WEB, channel: 'web', nombre: 'Luis Panel', contacto: 'luis.panel@3dev.test', necesidad: 'ortodoncia', at: at(59) }));

  // Sin sesión y con cookie basura: a entrar, nunca un 500.
  let r = await get('/panel');
  assert.ok([302, 303, 307].includes(r.status) && r.headers.get('location')?.includes('/panel/entrar'), `sin sesión: ${r.status}`);
  // Right cookie name for this project, garbage value: the parse path, not just an unknown cookie.
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host.split('.')[0];
  r = await get('/panel', `sb-${ref}-auth-token=basura`);
  assert.ok([302, 303, 307].includes(r.status), `cookie basura: ${r.status}`);
  r = await get('/panel/entrar');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Enviarme un código/);

  const cookie = await sessionCookie(OWNER);
  const page = async (path) => { const res = await get(path, cookie); assert.equal(res.status, 200, `${path}: ${res.status}`); return res.text(); };
  const resumen = await page('/panel?dias=7');
  assert.match(resumen, /Luis Panel/, 'el resumen lista los leads recientes');
  const lista = await page('/panel/conversaciones?dias=7');
  assert.ok(lista.indexOf('Ana Panel') < lista.indexOf('Luis Panel'), 'la más reciente arriba; el nombre del lead si el contacto no tiene');
  assert.match(lista, /dejó datos/);
  assert.match(await page('/panel/conversaciones?canal=whatsapp'), /Ana Panel/);
  assert.doesNotMatch(await page('/panel/conversaciones?canal=whatsapp'), /Luis Panel/, 'el filtro por canal funciona');
  const chat = await page(`/panel/conversaciones/${WA}`);
  assert.match(chat, /Quiero una limpieza el jueves/);
  assert.match(chat, /limpieza/);
  assert.match(await page(`/panel/conversaciones/${encodeURIComponent('no-existe/../x')}`), /Conversación no encontrada/);
  const leads = await page('/panel/leads');
  assert.match(leads, /mailto:luis\.panel@3dev\.test/);

  const strange = await get('/panel', await sessionCookie(STRANGER));
  assert.equal(strange.status, 200);
  const body = await strange.text();
  assert.match(body, /No tienes acceso a este panel/);
  assert.doesNotMatch(body, /Luis Panel/);

  r = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 400, 'el middleware no toca /api');
  console.log('check-panel-pages: passed');
} finally {
  await cleanup();
}
```

Run (dev server del demo encendido con `.env.demo-dental` cargado):
```bash
(set -a && . ./.env.demo-dental && set +a && CLIENT=demo-dental nohup caffeinate -i npx next dev > $S/dev-panel.log 2>&1 &)
node --env-file=.env.demo-dental scripts/check-panel-pages.mjs demo-dental
```
Expected: FAIL en `/panel?dias=7: 404`.

- [ ] **Step 2: Consultas — `app/panel/data.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAssistant } from '../assistant';
import { selectAll } from '../../core/store/db';
import { metaPhone } from '../../core/followup';
import { summarizeConversations, type ContactLite, type LeadLite, type MessageLite } from './shape';

const PAGE_SIZE = 50;

export interface Period { days: 7 | 30 | 90; since: Date }
export const periodOf = (days: 7 | 30 | 90): Period => ({ days, since: new Date(Date.now() - days * 864e5) });

/** Null when the calendar can't say: the screen shows "—" instead of a wrong zero. */
async function bookedPhones(since: Date): Promise<Set<string> | null> {
  const { scheduler } = await getAssistant();
  if (!scheduler.bookedPhones) return null;
  try {
    return new Set((await scheduler.bookedPhones(since)).map(metaPhone));
  } catch (error) {
    console.error('panel: could not read bookings', error);
    return null;
  }
}

async function messagesSince(sb: SupabaseClient, clientId: string, since: Date): Promise<MessageLite[]> {
  return selectAll<MessageLite>((from, to) =>
    sb.from('messages').select('contact_id, role, content, at').eq('client_id', clientId)
      .gte('at', since.toISOString()).order('at').order('id').range(from, to),
  );
}

// ponytail: every lead of the client in memory; fine for hundreds, paginate when a client has thousands.
async function leadsByContact(sb: SupabaseClient, clientId: string): Promise<Map<string, LeadLite>> {
  const rows = await selectAll<LeadLite>((from, to) =>
    sb.from('leads').select('contact_id, channel, nombre, contacto, necesidad, at').eq('client_id', clientId).order('at').order('id').range(from, to),
  );
  return new Map(rows.map((l) => [l.contact_id, l]));
}

async function contactsSeenSince(sb: SupabaseClient, clientId: string, since: Date): Promise<Map<string, ContactLite>> {
  const rows = await selectAll<ContactLite>((from, to) =>
    sb.from('contacts').select('contact_id, channel, name, interest, left_contact').eq('client_id', clientId)
      .gte('last_seen_at', since.toISOString()).order('contact_id').range(from, to),
  );
  return new Map(rows.map((c) => [c.contact_id, c]));
}

export async function loadSummary(sb: SupabaseClient, period: Period) {
  const { config } = await getAssistant();
  const [messages, leads, booked] = await Promise.all([
    messagesSince(sb, config.id, period.since),
    leadsByContact(sb, config.id),
    bookedPhones(period.since),
  ]);
  const userMessages = messages.filter((m) => m.role === 'user');
  const periodLeads = [...leads.values()].filter((l) => new Date(l.at) >= period.since).sort((a, b) => b.at.localeCompare(a.at));
  return {
    people: new Set(userMessages.map((m) => m.contact_id)).size,
    messages: userMessages.length,
    leads: periodLeads.length,
    booked: booked ? booked.size : null,
    recentLeads: periodLeads.slice(0, 5),
  };
}

export async function loadConversations(sb: SupabaseClient, period: Period, channel: string | undefined, page: number) {
  const { config } = await getAssistant();
  const [messages, contacts, leads, booked] = await Promise.all([
    messagesSince(sb, config.id, period.since),
    contactsSeenSince(sb, config.id, period.since),
    leadsByContact(sb, config.id),
    bookedPhones(period.since),
  ]);
  // ponytail: grouped in memory from the period's messages; move to a SQL view when a client passes ~50k messages per 90 days.
  const all = summarizeConversations(messages, contacts, leads, booked, config.followUp?.countryCode)
    .filter((row) => !channel || row.channel === channel);
  const start = (page - 1) * PAGE_SIZE;
  return { rows: all.slice(start, start + PAGE_SIZE), hasMore: all.length > start + PAGE_SIZE };
}

export async function loadConversation(sb: SupabaseClient, contactId: string) {
  const { config } = await getAssistant();
  const [{ data: contact }, { data: lead }, messages] = await Promise.all([
    sb.from('contacts').select('contact_id, channel, name, interest, left_contact').eq('client_id', config.id).eq('contact_id', contactId).maybeSingle(),
    sb.from('leads').select('contact_id, channel, nombre, contacto, necesidad, at').eq('client_id', config.id).eq('contact_id', contactId)
      .order('at', { ascending: false }).limit(1).maybeSingle(),
    selectAll<MessageLite>((from, to) =>
      sb.from('messages').select('contact_id, role, content, at').eq('client_id', config.id).eq('contact_id', contactId)
        .order('at').order('id').range(from, to),
    ),
  ]);
  if (!contact && !messages.length) return null;
  return { contact: (contact as ContactLite | null) ?? undefined, lead: (lead as LeadLite | null) ?? undefined, messages };
}

export async function loadLeads(sb: SupabaseClient, period: Period) {
  const { config } = await getAssistant();
  return [...(await leadsByContact(sb, config.id)).values()]
    .filter((l) => new Date(l.at) >= period.since)
    .sort((a, b) => b.at.localeCompare(a.at));
}
```

- [ ] **Step 3: Resumen — `app/panel/(app)/page.tsx`**

```tsx
import { getAssistant } from '../../assistant';
import { createPanelClient } from '../supabase';
import { loadSummary, periodOf } from '../data';
import { formatWhen, parseDays } from '../shape';
import { Nav } from '../nav';

export default async function ResumenPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const days = parseDays((await searchParams).dias);
  const { config } = await getAssistant();
  const s = await loadSummary(await createPanelClient(), periodOf(days));
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  return (
    <>
      <Nav active="resumen" days={days} />
      <div className="stats">
        <div className="stat"><b>{s.people}</b><span>personas escribieron</span></div>
        <div className="stat"><b>{s.leads}</b><span>dejaron sus datos</span></div>
        <div className="stat"><b>{s.booked ?? '—'}</b><span>agendaron cita</span></div>
        <div className="stat"><b>{s.messages}</b><span>mensajes recibidos</span></div>
      </div>
      <div className="sub">Últimos leads</div>
      {s.recentLeads.length ? (
        <ul className="rows">
          {s.recentLeads.map((l) => (
            <li key={`${l.contact_id}-${l.at}`}>
              <div className="row-top">
                <a href={`/panel/conversaciones/${encodeURIComponent(l.contact_id)}?dias=${days}`}><b>{l.nombre}</b></a>
                <span className="when">{formatWhen(l.at, config.locale, tz, now)}</span>
              </div>
              <div className="preview">{l.necesidad ?? l.contacto}</div>
            </li>
          ))}
        </ul>
      ) : <p className="notice">Nadie ha dejado sus datos en este periodo.</p>}
    </>
  );
}
```

- [ ] **Step 4: Lista — `app/panel/(app)/conversaciones/page.tsx`**

```tsx
import { getAssistant } from '../../../assistant';
import { createPanelClient } from '../../supabase';
import { loadConversations, periodOf } from '../../data';
import { formatWhen, parseDays } from '../../shape';
import { Nav } from '../../nav';

type Search = Promise<{ dias?: string; canal?: string; pagina?: string }>;

export default async function ConversacionesPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const days = parseDays(q.dias);
  const channel = q.canal === 'whatsapp' || q.canal === 'web' ? q.canal : undefined;
  const page = Math.max(1, Number(q.pagina) || 1);
  const { config } = await getAssistant();
  const { rows, hasMore } = await loadConversations(await createPanelClient(), periodOf(days), channel, page);
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  const link = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams({ dias: String(days), ...(channel ? { canal: channel } : {}) });
    for (const [k, v] of Object.entries(extra)) v === undefined ? p.delete(k) : p.set(k, String(v));
    return `/panel/conversaciones?${p}`;
  };
  return (
    <>
      <Nav active="conversaciones" days={days} />
      <div className="period">
        <a href={link({ canal: undefined, pagina: undefined })} aria-current={!channel ? 'true' : undefined}>Todas</a>
        <a href={link({ canal: 'whatsapp', pagina: undefined })} aria-current={channel === 'whatsapp' ? 'true' : undefined}>WhatsApp</a>
        <a href={link({ canal: 'web', pagina: undefined })} aria-current={channel === 'web' ? 'true' : undefined}>Web</a>
      </div>
      {rows.length ? (
        <ul className="rows">
          {rows.map((r) => (
            <li key={r.contactId}>
              <div className="row-top">
                <a href={`/panel/conversaciones/${encodeURIComponent(r.contactId)}?dias=${days}`}><b>{r.name}</b></a>
                <span className="when">{formatWhen(r.lastAt, config.locale, tz, now)}</span>
              </div>
              <div className="tags">
                {r.channel === 'whatsapp' ? 'WhatsApp' : 'Web'} · {r.count} mensajes
                {r.leftData && <span className="on"> · dejó datos</span>}
                {r.booked && <span className="on"> · agendó</span>}
              </div>
              <div className="preview">{r.lastText}</div>
            </li>
          ))}
        </ul>
      ) : <p className="notice">No hubo conversaciones en este periodo.</p>}
      <div className="pager">
        {page > 1 ? <a href={link({ pagina: page - 1 })}>‹ Anteriores</a> : <span />}
        {hasMore ? <a href={link({ pagina: page + 1 })}>Siguientes ›</a> : <span />}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Conversación — `app/panel/(app)/conversaciones/[contactId]/page.tsx`**

```tsx
import { getAssistant } from '../../../../assistant';
import { createPanelClient } from '../../../supabase';
import { loadConversation } from '../../../data';
import { contactLink, contactPhone, dayKey, displayName, formatWhen, parseDays } from '../../../shape';

type Props = { params: Promise<{ contactId: string }>; searchParams: Promise<{ dias?: string }> };

export default async function ConversacionPage({ params, searchParams }: Props) {
  const contactId = decodeURIComponent((await params).contactId);
  const days = parseDays((await searchParams).dias);
  const { config } = await getAssistant();
  const back = <a href={`/panel/conversaciones?dias=${days}`}>‹ Conversaciones</a>;
  const data = await loadConversation(await createPanelClient(), contactId);
  if (!data) return <>{back}<p className="notice">Conversación no encontrada.</p></>;

  const { contact, lead, messages } = data;
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  const channel = contact?.channel ?? lead?.channel ?? 'web';
  const reach = lead ? contactLink(lead.contacto, config.followUp?.countryCode) : null;
  let lastDay = '';
  return (
    <>
      {back}
      <h1 style={{ marginTop: 8 }}>{displayName(contactId, channel, contact, lead)}</h1>
      <div className="sub" style={{ marginBottom: 12 }}>
        {channel === 'whatsapp' ? <>WhatsApp · <a href={`https://wa.me/${contactPhone(contactId, 'whatsapp') ?? contactId}`}>+{contactId}</a></> : 'Web'}
        {reach && <> · <a href={reach.href}>{reach.label}</a></>}
        {(contact?.interest || lead?.necesidad) && <> · le interesa: {contact?.interest ?? lead?.necesidad}</>}
      </div>
      <div className="bubbles">
        {messages.map((m, i) => {
          const day = dayKey(m.at, tz);
          const separator = day !== lastDay ? <div className="day">{formatWhen(m.at, config.locale, tz, now)}</div> : null;
          lastDay = day;
          return (
            <div key={i} style={{ display: 'contents' }}>
              {separator}
              <div className={`bubble ${m.role}`}>{m.content}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
```

- [ ] **Step 6: Leads — `app/panel/(app)/leads/page.tsx`**

```tsx
import { getAssistant } from '../../../assistant';
import { createPanelClient } from '../../supabase';
import { loadLeads, periodOf } from '../../data';
import { contactLink, formatWhen, parseDays } from '../../shape';
import { Nav } from '../../nav';

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const days = parseDays((await searchParams).dias);
  const { config } = await getAssistant();
  const leads = await loadLeads(await createPanelClient(), periodOf(days));
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  return (
    <>
      <Nav active="leads" days={days} />
      {leads.length ? (
        <ul className="rows">
          {leads.map((l) => {
            const reach = contactLink(l.contacto, config.followUp?.countryCode);
            return (
              <li key={`${l.contact_id}-${l.at}`}>
                <div className="row-top"><b>{l.nombre}</b><span className="when">{formatWhen(l.at, config.locale, tz, now)}</span></div>
                <div>{reach ? <a href={reach.href}>{reach.label}</a> : l.contacto}</div>
                {l.necesidad && <div className="preview">{l.necesidad}</div>}
                <a className="tags" href={`/panel/conversaciones/${encodeURIComponent(l.contact_id)}?dias=${days}`}>Ver conversación ›</a>
              </li>
            );
          })}
        </ul>
      ) : <p className="notice">Nadie ha dejado sus datos en este periodo.</p>}
    </>
  );
}
```

- [ ] **Step 7: Error — `app/panel/(app)/error.tsx`**

```tsx
'use client';

export default function PanelError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p className="notice">No pudimos cargar los datos. Intenta de nuevo en un momento.</p>
      <button type="button" onClick={reset}>Reintentar</button>
    </div>
  );
}
```

- [ ] **Step 8: Ver la prueba pasar**

Run: `node --env-file=.env.demo-dental scripts/check-panel-pages.mjs demo-dental`
Expected: `check-panel-pages: passed`. Después `pkill -f "next dev"`.

- [ ] **Step 9: Tipos, frontera, autopruebas**

Run: `npx tsc --noEmit && npm run -s check:boundary && node app/panel/shape.ts && node core/store/db.ts`
Expected: sin errores y las dos autopruebas en verde.

- [ ] **Step 10: Commit**

```bash
git add app/panel/data.ts "app/panel/(app)" scripts/check-panel-pages.mjs
git commit -m "feat: resumen, conversaciones y leads en el panel del cliente"
```

---

### Task 6: Documentación, regresión y build

**Files:**
- Modify: `CLAUDE.md`, `docs/nuevo-cliente.md`

- [ ] **Step 1: `CLAUDE.md`** — nueva sección después de "Registro de conversaciones":

```md
## Panel del cliente

`/panel` en el dominio de cada cliente (`app/panel/`): el dueño entra con
un código de 6 dígitos por correo (Supabase Auth, `shouldCreateUser:
false`) y ve Resumen, Conversaciones y Leads de su negocio, en solo
lectura. Las páginas leen con la sesión del usuario (`@supabase/ssr`,
llave pública) y RLS decide qué filas ve: solo los `client_id` que tiene
en `dashboard_users`; ninguna política permite escribir. El panel nunca
usa `service_role`. `middleware.ts` solo corre en `/panel/*`. Accesos:
`node --env-file=.env.local scripts/panel-user.mjs add|remove <correo>
<clientId>` y `list <clientId>`. Los códigos salen por el SMTP de Resend
configurado en Supabase. Pruebas: `scripts/check-panel-rls.mjs` (base
real) y `scripts/check-panel-pages.mjs <clientId>` (contra el dev server,
con sesión real y sin mandar correos). Las citas del resumen y la
etiqueta "agendó" salen de Cal.com (`scheduler.bookedPhones`).
```

Y en "Hoja de ruta", cambiar "Dashboard de cliente, panel de administración para 3dev, …" por "Panel de administración para 3dev, …" (el dashboard del cliente ya existe).

- [ ] **Step 2: `docs/nuevo-cliente.md`** — en la sección 7 ("Abrirlo"), agregar:

```md
5. Panel: dale acceso al dueño
   ```bash
   node --env-file=.env.local scripts/panel-user.mjs add <correo-del-dueño> <id-de-la-config>
   ```
   Entra en `https://<dominio-del-cliente>/panel` con el código que le llega por correo.
```

- [ ] **Step 3: Regresión**

```bash
(WHATSAPP_APP_SECRET=local nohup caffeinate -i npx next dev > $S/dev-3dev.log 2>&1 &)   # esperar 200
WHATSAPP_APP_SECRET=local npm run eval:3dev
pkill -f "next dev"
node --env-file=.env.local scripts/check-panel-rls.mjs
npm run build
```

Expected: `20/20 passed, 1 saltados`; `check-panel-rls: passed`; build sin errores.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/nuevo-cliente.md docs/superpowers/specs/2026-10-20-panel-cliente-design.md docs/superpowers/plans/2026-10-20-panel-cliente.md
git commit -m "docs: panel del cliente en CLAUDE.md y en la guía de alta"
```

---

### Task 7: SMTP, despliegue y prueba de punta a punta

- [ ] **Step 1: STOP — Marco configura el correo en Supabase**

1. Supabase → **Authentication → SMTP Settings** → Enable custom SMTP:
   host `smtp.resend.com` · port `465` · username `resend` · password = su `RESEND_API_KEY` · sender email `notificaciones@3dev.mx` · sender name `Panel Quetzal`.
2. **Authentication → Email Templates → Magic Link**:
   - Asunto: `Tu código para entrar al panel`
   - Cuerpo:
     ```html
     <p>Tu código para entrar al panel es:</p>
     <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
     <p>Vence en una hora. Si no lo pediste, ignora este correo.</p>
     ```

- [ ] **Step 2: STOP — visto bueno para subir y desplegar**

Merge fast-forward a `main` y `git push`. Confirmar `Ready` en `3dev-quetzal` y `quetzal-demo-dental` (`npx -y vercel@latest ls <proyecto> --environment production`).

- [ ] **Step 3: Humo en producción**

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://demo.3dev.mx/panel
curl -s https://demo.3dev.mx/panel/entrar | grep -c 'Enviarme un código'
```

Expected: `307 https://demo.3dev.mx/panel/entrar` y `1`.

- [ ] **Step 4: Marco entra de verdad**

`node --env-file=.env.local scripts/panel-user.mjs add <correo de Marco> demo-dental`. Marco abre https://demo.3dev.mx/panel, pide el código, lo escribe y recorre Resumen, Conversaciones (abre una) y Leads, en el celular.

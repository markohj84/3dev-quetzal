import assert from 'node:assert';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CapturedLead } from '../tools';
import type { Handoff } from '../handoff';
import type { EarlierMessage } from '../engine/prompt';

let client: SupabaseClient | null = null;
const DB_TIMEOUT_MS = 3_000;

/**
 * Lazy: `next build` imports every route without the env, and a Preview
 * deploy may lack it. Only a call that actually touches the database fails.
 */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      // A database that hangs must cost a log line, not the person's reply:
      // every caller in a route already treats a failure as non-fatal. The
      // built-in retries (1 s, 2 s, 4 s on reads) would stretch 3 s into 19 s.
      db: { retry: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(DB_TIMEOUT_MS) }) },
    });
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
/** The privacy notice promises 90 days of WhatsApp memory; 30 messages keep the prompt small. */
const MEMORY_DAYS = 90;
const MEMORY_MESSAGES = 30;

export interface LogEntry {
  channel: string;
  contactId: string;
  userText: string;
  assistantText: string;
  at: Date;
}

export interface ConversationLog {
  append(entry: LogEntry): Promise<void>;
  /** The person's message with no reply: the owner has the conversation. */
  appendInbound(entry: Omit<LogEntry, 'assistantText'>): Promise<void>;
  /** What this person said before `before` (the current conversation's start): memory for the next reply. */
  earlier(contactId: string, before: Date): Promise<EarlierMessage[]>;
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

/** first_seen_at is the first turn's time, set once: insert-or-ignore, then move last_seen_at forward. */
async function touchContact(clientId: string, contactId: string, channel: string, at: string): Promise<void> {
  const key = { client_id: clientId, contact_id: contactId };
  const created = await must(
    db()
      .from('contacts')
      .upsert({ ...key, channel, first_seen_at: at, last_seen_at: at }, { onConflict: 'client_id,contact_id', ignoreDuplicates: true })
      .select('contact_id'),
  );
  if (!created.length) {
    await must(db().from('contacts').update({ channel, last_seen_at: at }).match(key).lt('last_seen_at', at));
  }
}

export function createConversationLog(clientId: string): ConversationLog {
  return {
    async append(entry) {
      await touchContact(clientId, entry.contactId, entry.channel, entry.at.toISOString());
      await must(db().from('messages').insert(logEntryToMessages(clientId, entry)));
    },
    async earlier(contactId, before) {
      const since = new Date(Date.now() - MEMORY_DAYS * DAY_MS).toISOString();
      const rows = await must(
        db().from('messages').select('role, content, at').eq('client_id', clientId).eq('contact_id', contactId)
          .lt('at', before.toISOString()).gte('at', since)
          .order('at', { ascending: false }).order('id', { ascending: false }).limit(MEMORY_MESSAGES),
      );
      return (rows as EarlierMessage[]).reverse();
    },
    async appendInbound(entry) {
      const at = entry.at.toISOString();
      await touchContact(clientId, entry.contactId, entry.channel, at);
      await must(db().from('messages').insert({ client_id: clientId, contact_id: entry.contactId, role: 'user', content: entry.userText, at }));
    },
  };
}

/**
 * Older history into contacts without undoing newer writes (the one-time
 * Redis migration runs after the deploy, so live traffic is already here):
 * inserts the missing ones; for the rest, only moves first_seen_at back and
 * fills fields that are still empty.
 */
export async function backfillContacts(rows: ContactRow[]): Promise<void> {
  if (!rows.length) return;
  await must(db().from('contacts').upsert(rows, { onConflict: 'client_id,contact_id', ignoreDuplicates: true }));
  for (const row of rows) {
    const key = { client_id: row.client_id, contact_id: row.contact_id };
    const contacts = () => db().from('contacts');
    if (row.first_seen_at) await must(contacts().update({ first_seen_at: row.first_seen_at }).match(key).gt('first_seen_at', row.first_seen_at));
    if (row.name) await must(contacts().update({ name: row.name }).match(key).is('name', null));
    if (row.interest) await must(contacts().update({ interest: row.interest }).match(key).is('interest', null));
    if (row.left_contact) await must(contacts().update({ left_contact: true }).match(key).eq('left_contact', false));
  }
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

/** The model-token cost of one reply, kept per client so 3dev can price a plan with real numbers. */
export interface ReplyUsageRecord {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
}

export interface UsageLog {
  record(contactId: string, usage: ReplyUsageRecord): Promise<void>;
}

export function createUsageLog(clientId: string): UsageLog {
  return {
    async record(contactId, u) {
      await must(
        db().from('usage').insert({
          client_id: clientId,
          contact_id: contactId,
          model: u.model,
          input_tokens: u.input,
          output_tokens: u.output,
          cache_read_tokens: u.cacheRead,
          cache_write_tokens: u.cacheWrite,
          calls: u.calls,
        }),
      );
    },
  };
}

export interface HandoffStore {
  get(contactId: string): Promise<Handoff | null>;
  release(contactId: string): Promise<void>;
  markNotified(contactId: string): Promise<void>;
}

/** The webhook's view of who has a conversation (service_role: the person writing has no session). */
export function createHandoffStore(clientId: string): HandoffStore {
  const row = (contactId: string) => db().from('handoffs').select('*').eq('client_id', clientId).eq('contact_id', contactId);
  return {
    async get(contactId) {
      return ((await must(row(contactId).maybeSingle())) as Handoff | null) ?? null;
    },
    async release(contactId) {
      await must(db().from('handoffs').delete().eq('client_id', clientId).eq('contact_id', contactId));
    },
    async markNotified(contactId) {
      await must(db().from('handoffs').update({ notified_at: new Date().toISOString() }).eq('client_id', clientId).eq('contact_id', contactId));
    },
  };
}

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

  // timeout: a database that accepts the connection and never answers must
  // not hold the reply until the function dies.
  const { createServer } = await import('node:http');
  const hang = createServer(() => {});
  await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', resolve));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(hang.address() as { port: number }).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  const started = Date.now();
  const outcome = await Promise.race([
    createLeadStore('c').list().then(() => 'answered', () => 'rejected'),
    new Promise((resolve) => setTimeout(() => resolve('still waiting'), 6000)),
  ]);
  hang.closeAllConnections();
  hang.close();
  assert.equal(outcome, 'rejected', `a hung database must fail fast (${Date.now() - started} ms)`);

  process.env.SUPABASE_URL = saved.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;

  console.log('db.ts self-check passed');
}

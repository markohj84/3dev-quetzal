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
      const at = entry.at.toISOString();
      const key = { client_id: clientId, contact_id: entry.contactId };
      // first_seen_at is the first turn's time, set once: insert-or-ignore,
      // then move last_seen_at only when the contact already existed.
      const created = await must(
        db()
          .from('contacts')
          .upsert({ ...key, channel: entry.channel, first_seen_at: at, last_seen_at: at }, {
            onConflict: 'client_id,contact_id',
            ignoreDuplicates: true,
          })
          .select('contact_id'),
      );
      if (!created.length) {
        await must(
          db().from('contacts').update({ channel: entry.channel, last_seen_at: at }).match(key).lt('last_seen_at', at),
        );
      }
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

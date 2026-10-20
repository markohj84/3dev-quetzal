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

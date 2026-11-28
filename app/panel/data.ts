import type { SupabaseClient } from '@supabase/supabase-js';
import { getAssistantOr404 } from '../assistant';
import { selectAll } from '../../core/store/db';
import { metaPhone } from '../../core/followup';
import { isTaken, type Handoff } from '../../core/handoff';
import { contactPhone, summarizeConversations, type ContactLite, type LeadLite, type MessageLite } from './shape';
import type { UpcomingBooking } from '../../core/scheduling/types';

const PAGE_SIZE = 50;
/** Eval runs write to the same database; the report hides them, so does the panel. */
const EVAL = 'eval%';

/**
 * Every loader checks access itself, before anything else runs: the layout's
 * check is skipped when Next renders only the page segment, and Cal.com is
 * called with the client's key, which RLS can't guard.
 */
export async function requireAccess(sb: SupabaseClient, clientId: string): Promise<void> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('panel: no session');
  const { data, error } = await sb.from('dashboard_users').select('client_id').eq('client_id', clientId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('panel: no access to this client');
}

export interface Period { days: 7 | 30 | 90; since: Date }
export const periodOf = (days: 7 | 30 | 90): Period => ({ days, since: new Date(Date.now() - days * 864e5) });

/** Null when the calendar can't say: the screen shows "—" instead of a wrong zero. */
async function bookedPhones(since: Date): Promise<Set<string> | null> {
  const { scheduler } = await getAssistantOr404();
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
    sb.from('messages').select('contact_id, role, content, at').eq('client_id', clientId).not('contact_id', 'like', EVAL)
      .gte('at', since.toISOString()).order('at').order('id').range(from, to),
  );
}

// ponytail: every lead of the client in memory; fine for hundreds, paginate when a client has thousands.
async function leadsByContact(sb: SupabaseClient, clientId: string): Promise<Map<string, LeadLite>> {
  const rows = await selectAll<LeadLite>((from, to) =>
    sb.from('leads').select('contact_id, channel, nombre, contacto, necesidad, at').eq('client_id', clientId).not('contact_id', 'like', EVAL).order('at').order('id').range(from, to),
  );
  return new Map(rows.map((l) => [l.contact_id, l]));
}

async function contactsSeenSince(sb: SupabaseClient, clientId: string, since: Date): Promise<Map<string, ContactLite>> {
  const rows = await selectAll<ContactLite>((from, to) =>
    sb.from('contacts').select('contact_id, channel, name, interest, left_contact').eq('client_id', clientId).not('contact_id', 'like', EVAL)
      .gte('last_seen_at', since.toISOString()).order('contact_id').range(from, to),
  );
  return new Map(rows.map((c) => [c.contact_id, c]));
}

export async function loadSummary(sb: SupabaseClient, period: Period) {
  const { config } = await getAssistantOr404();
  await requireAccess(sb, config.id);
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
  const { config } = await getAssistantOr404();
  await requireAccess(sb, config.id);
  const [messages, contacts, leads, booked, handoffRows] = await Promise.all([
    messagesSince(sb, config.id, period.since),
    contactsSeenSince(sb, config.id, period.since),
    leadsByContact(sb, config.id),
    bookedPhones(period.since),
    sb.from('handoffs').select('*').eq('client_id', config.id),
  ]);
  const now = new Date();
  const taken = new Set(((handoffRows.data ?? []) as Handoff[]).filter((h) => isTaken(h, now)).map((h) => h.contact_id));
  // ponytail: grouped in memory from the period's messages; move to a SQL view when a client passes ~50k messages per 90 days.
  const all = summarizeConversations(messages, contacts, leads, booked, config.followUp?.countryCode)
    .filter((row) => !channel || row.channel === channel);
  const start = (page - 1) * PAGE_SIZE;
  return { rows: all.slice(start, start + PAGE_SIZE), hasMore: all.length > start + PAGE_SIZE, taken };
}

export async function loadConversation(sb: SupabaseClient, contactId: string) {
  const { config } = await getAssistantOr404();
  await requireAccess(sb, config.id);
  const [{ data: contact }, { data: lead }, messages, { data: handoff }] = await Promise.all([
    sb.from('contacts').select('contact_id, channel, name, interest, left_contact').eq('client_id', config.id).eq('contact_id', contactId).maybeSingle(),
    sb.from('leads').select('contact_id, channel, nombre, contacto, necesidad, at').eq('client_id', config.id).eq('contact_id', contactId)
      .order('at', { ascending: false }).limit(1).maybeSingle(),
    selectAll<MessageLite>((from, to) =>
      sb.from('messages').select('contact_id, role, content, at').eq('client_id', config.id).eq('contact_id', contactId)
        .order('at').order('id').range(from, to),
    ),
    sb.from('handoffs').select('*').eq('client_id', config.id).eq('contact_id', contactId).maybeSingle(),
  ]);
  if (!contact && !messages.length) return null;
  const lastUserAt = [...messages].reverse().find((m) => m.role === 'user')?.at ?? null;
  return {
    contact: (contact as ContactLite | null) ?? undefined,
    lead: (lead as LeadLite | null) ?? undefined,
    messages,
    handoff: (handoff as Handoff | null) ?? null,
    lastUserAt,
  };
}

export async function loadLeads(sb: SupabaseClient, period: Period) {
  const { config } = await getAssistantOr404();
  await requireAccess(sb, config.id);
  return [...(await leadsByContact(sb, config.id)).values()]
    .filter((l) => new Date(l.at) >= period.since)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export type ListedBooking = UpcomingBooking & { contactId?: string };
export type UpcomingView =
  | { state: 'unsupported'; dashboardUrl?: string; bookingUrl: string }
  | { state: 'error'; dashboardUrl?: string }
  | { state: 'ok'; dashboardUrl?: string; bookings: ListedBooking[] };

/** Bookings ahead from the calendar, each tied to its conversation when the phone or email matches one. */
export async function loadUpcoming(sb: SupabaseClient): Promise<UpcomingView> {
  const { config, scheduler } = await getAssistantOr404();
  await requireAccess(sb, config.id);
  const dashboardUrl = scheduler.dashboardUrl;
  if (!scheduler.upcoming) return { state: 'unsupported', dashboardUrl, bookingUrl: scheduler.bookingUrl() };
  let bookings: UpcomingBooking[];
  try {
    bookings = await scheduler.upcoming();
  } catch (error) {
    console.error('panel: could not read upcoming bookings', error);
    return { state: 'error', dashboardUrl };
  }
  const [leads, contacts] = await Promise.all([
    leadsByContact(sb, config.id),
    contactsSeenSince(sb, config.id, new Date(Date.now() - 90 * 864e5)),
  ]);
  const cc = config.followUp?.countryCode;
  const byKey = new Map<string, string>();
  for (const [id, lead] of leads) {
    const phone = contactPhone(id, lead.channel, lead, cc);
    if (phone) byKey.set(phone, id);
    if (lead.contacto.includes('@')) byKey.set(lead.contacto.trim().toLowerCase(), id);
  }
  // A WhatsApp number beats a lead's typed phone: it is the conversation that holds the thread.
  for (const [id, c] of contacts) {
    const phone = contactPhone(id, c.channel, leads.get(id), cc);
    if (phone) byKey.set(phone, id);
  }
  return {
    state: 'ok',
    dashboardUrl,
    bookings: bookings.map((b) => {
      const contactId = (b.phone && byKey.get(metaPhone(b.phone))) || (b.email && byKey.get(b.email.toLowerCase())) || undefined;
      return contactId ? { ...b, contactId } : b;
    }),
  };
}

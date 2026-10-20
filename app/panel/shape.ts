import assert from 'node:assert';
import { leadPhone, metaPhone } from '../../core/followup.ts';

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
/**
 * After asking for a code, every email gets the same screen: only emails that
 * exist hit Supabase's per-user resend limit, so "wait" would reveal them.
 */
export function stateAfterSend(_status?: number): 'enviado' {
  return 'enviado';
}

/** The code was typed for an email the person already gave, so here a rate limit can be said. */
export function stateAfterVerify(status?: number): 'espera' | 'codigo' {
  return status === 429 ? 'espera' : 'codigo';
}

export function loginMessage(state?: string): string | null {
  switch (state) {
    case 'enviado': return 'Si tu correo tiene acceso, te llegó un código. Escríbelo aquí.';
    case 'codigo': return 'Código incorrecto o vencido.';
    case 'espera': return 'Espera un minuto y vuelve a intentar.';
    case 'correo': return 'Escribe un correo válido.';
    default: return null;
  }
}

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

  // The send step looks the same for every email: a rate limit only hits emails that exist.
  assert.equal(stateAfterSend(undefined), 'enviado');
  assert.equal(stateAfterSend(422), 'enviado', 'correo sin acceso');
  assert.equal(stateAfterSend(429), 'enviado', 'un límite de envíos no delata que el correo existe');
  assert.equal(stateAfterVerify(429), 'espera');
  assert.equal(stateAfterVerify(400), 'codigo');

  assert.equal(loginMessage(undefined), null);
  assert.equal(loginMessage('enviado'), 'Si tu correo tiene acceso, te llegó un código. Escríbelo aquí.');
  assert.equal(loginMessage('codigo'), 'Código incorrecto o vencido.');
  assert.equal(loginMessage('espera'), 'Espera un minuto y vuelve a intentar.');
  assert.equal(loginMessage('correo'), 'Escribe un correo válido.');

  console.log('shape.ts self-check passed');
}

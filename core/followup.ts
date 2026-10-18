import assert from 'node:assert';
import { toMetaRecipient } from './channels/whatsapp.ts';

export interface LeadForFollowUp {
  nombre: string;
  contacto: string;
  channel: string;
  contactId: string;
  at: string;
}

/**
 * The number Meta can deliver to, or null. A WhatsApp lead's id is their
 * number; a web lead only has one if they typed a phone. Ten digits are
 * read as a national number, which needs the client's country code.
 */
export function leadPhone(lead: LeadForFollowUp, countryCode?: string): string | null {
  if (lead.channel === 'whatsapp') return /^\d{10,15}$/.test(lead.contactId) ? toMetaRecipient(lead.contactId) : null;
  if (lead.contacto.includes('@')) return null;

  const digits = lead.contacto.replace(/\D/g, '');
  if (digits.length === 10) return countryCode ? countryCode + digits : null;
  if (digits.length >= 11 && digits.length <= 15) return toMetaRecipient(digits);
  return null;
}

/**
 * Leads old enough to follow up, but not so old that a message would come
 * out of nowhere: the cron runs once a day, so the window spans two runs
 * and a missed run still catches everyone. Latest lead per number wins.
 */
export function dueFollowUps(
  leads: LeadForFollowUp[],
  now: Date,
  afterHours: number,
  countryCode?: string,
): { phone: string; lead: LeadForFollowUp }[] {
  const hour = 60 * 60 * 1000;
  const newest = now.getTime() - afterHours * hour;
  const oldest = newest - 48 * hour;

  const byPhone = new Map<string, LeadForFollowUp>();
  for (const lead of leads) {
    // A killed eval run leaves its leads behind, with made-up numbers that
    // may belong to someone real.
    if (lead.contactId.startsWith('eval-')) continue;
    const at = new Date(lead.at).getTime();
    if (!(at <= newest && at > oldest)) continue;
    const phone = leadPhone(lead, countryCode);
    if (phone) byPhone.set(phone, lead);
  }
  return [...byPhone].map(([phone, lead]) => ({ phone, lead }));
}

/** A phone as Cal.com stores it (+521…) in the form leadPhone() produces. */
export function metaPhone(phone: string): string {
  return toMetaRecipient(phone.replace(/\D/g, ''));
}

/** "Juan Pérez" → "Juan": the template greets, it doesn't read out a record. */
export function firstName(nombre: string): string {
  const first = nombre.trim().split(/\s+/)[0] ?? '';
  return /^<|unknown|desconocido|sin nombre/i.test(first) ? '' : first;
}

// Self-check: `node core/followup.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const wa = { nombre: 'Ana', contacto: 'x', channel: 'whatsapp', contactId: '5212225344440', at: '' };
  assert.equal(leadPhone(wa), '522225344440', 'el 521 de Meta se normaliza');
  assert.equal(leadPhone({ ...wa, contactId: 'eval-wa-abc' }), null, 'un id sin dígitos no es número');
  const web = { nombre: 'Luis', contacto: '222-555-0101', channel: 'web', contactId: 's1', at: '' };
  assert.equal(leadPhone(web, '52'), '522225550101', 'diez dígitos + lada del cliente');
  assert.equal(leadPhone(web), null, 'sin lada configurada no se adivina el país');
  assert.equal(leadPhone({ ...web, contacto: '+52 222 555 0101' }, '52'), '522225550101');
  assert.equal(leadPhone({ ...web, contacto: 'luis@x.mx' }, '52'), null, 'un correo no recibe WhatsApp');

  const now = new Date('2026-10-12T16:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  const due = dueFollowUps(
    [
      { ...wa, at: ago(30) },
      { ...web, at: ago(10) },
      { ...web, contacto: '2225559999', at: ago(80) },
      { ...wa, nombre: 'Ana López', at: ago(26) },
    ],
    now,
    24,
    '52',
  );
  assert.equal(due.length, 1, 'muy reciente y muy viejo quedan fuera; mismo número cuenta una vez');
  assert.equal(due[0].lead.nombre, 'Ana López', 'gana el lead más reciente');
  assert.equal(dueFollowUps([{ ...web, contactId: 'eval-3-123', at: ago(30) }], now, 24, '52').length, 0, 'un lead de eval nunca recibe WhatsApp');

  assert.equal(metaPhone('+52 1 222 534 4440'), leadPhone(wa), 'el teléfono de Cal.com y el del lead se comparan igual');

  assert.equal(firstName('Juan Pérez'), 'Juan');
  assert.equal(firstName('<UNKNOWN>'), '', 'el placeholder del modelo no se saluda');

  console.log('followup.ts self-check passed');
}

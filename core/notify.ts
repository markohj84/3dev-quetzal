import assert from 'node:assert';
import type { Turn } from './engine';
import type { CapturedLead } from './tools';
import type { Booking } from './scheduling/calendly-webhook';
import type { NotifyConfig } from './config/schema';
import { sendTemplate, templateParam } from './channels/whatsapp.ts';

export interface LeadAlert {
  channel: string;
  contactId: string;
  transcript: Turn[];
  /** Set when capture_lead was called this turn — puts real contact info front and center. */
  captured?: CapturedLead;
  /** Set when the alert is a confirmed booking rather than interest. */
  booking?: Booking;
  /**
   * A way to reach the person on the channel they wrote from, when the channel
   * has one. A WhatsApp sender's id is their phone; a web session id is not.
   */
  reachAt?: string;
  /** Where the owner reads and answers this conversation, when the panel can be reached. */
  panelUrl?: string;
  /** Set when the person wrote into a conversation the owner has taken. */
  inbound?: { name: string; text: string };
}

export interface LeadNotifier {
  notify(alert: LeadAlert): Promise<void>;
}

/**
 * Fires once per conversation, the moment it crosses into "real interest"
 * (the same signal that flips hasOffered) — not on every turn.
 */
export function createLeadNotifier(config: NotifyConfig): LeadNotifier {
  return {
    async notify(alert) {
      // Each channel on its own: a failed WhatsApp send must not cost the email.
      const results = await Promise.allSettled([
        sendEmail(config.email, config.fromEmail, alert),
        sendWhatsApp(config.whatsapp, alert),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') console.error('lead alert failed', r.reason);
      }
    },
  };
}

/** Resend's plain HTTP API directly; a single POST doesn't need the SDK. */
async function sendEmail(to: string | undefined, from: string | undefined, alert: LeadAlert): Promise<void> {
  if (!to || !from) return;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY no configurado — no se pudo notificar el lead');
    return;
  }

  const transcript = alert.transcript
    .map((t) => `${t.role === 'user' ? 'Prospecto' : 'Asistente'}: ${t.content}`)
    .join('\n\n');

  // A booking arrives from the calendar, not from a conversation: there is
  // no transcript to attach and nothing for the reader to decide.
  const booking = alert.booking
    ? [
        `Nombre: ${alert.booking.nombre}`,
        alert.booking.email ? `Correo: ${alert.booking.email}` : '',
        alert.booking.contacto ? `Notas: ${alert.booking.contacto}` : '',
        alert.booking.evento ? `Evento: ${alert.booking.evento}` : '',
        alert.booking.inicia ? `Cuándo: ${alert.booking.inicia}` : '',
        alert.booking.cancelUrl ? `Cancelar: ${alert.booking.cancelUrl}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  // On WhatsApp this is often the only contact there is: someone can show
  // interest, or say "call me on this number", without typing a number.
  const reach = alert.reachAt ? `Contactar por ${alert.channel}: ${alert.reachAt}\n\n` : '';

  const header = alert.captured
    ? `Nombre: ${alert.captured.nombre}\nContacto: ${alert.captured.contacto}` +
      (alert.captured.necesidad ? `\nNecesidad: ${alert.captured.necesidad}` : '') +
      '\n\n---\n\n'
    : '';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: alert.inbound
        ? `${alert.inbound.name} te escribió (conversación tomada)`
        : alert.booking
          ? `Cita agendada — ${alert.booking.nombre}`
          : alert.captured
            ? `Lead capturado — ${alert.captured.nombre} · canal ${alert.channel}`
            : `Nuevo interés — canal ${alert.channel}`,
      // A booking made in the chat does have a conversation behind it.
      text: alert.inbound
        ? `${alert.inbound.name}: ${alert.inbound.text}\n\n${alert.panelUrl ? `Contéstale en el panel: ${alert.panelUrl}` : 'Contéstale desde el panel.'}`
        : (alert.panelUrl ? `Ver en el panel: ${alert.panelUrl}\n\n` : '') +
          (booking ? [booking, transcript].filter(Boolean).join('\n\n---\n\n') : reach + header + transcript),
    }),
  });

  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
  }
}

/** The four template variables, in order: kind of alert, name, contact, detail. */
export function whatsAppAlertParams(alert: LeadAlert): string[] {
  // The link must survive Meta's per-variable cap whole, so the text gives way to it.
  const withLink = (detail: string | undefined) => {
    if (!alert.panelUrl) return detail;
    const room = 200 - alert.panelUrl.length - 1;
    const clean = (detail ?? '').replace(/\s+/g, ' ').trim();
    const short = clean.length > room ? `${clean.slice(0, room - 1).trimEnd()}…` : clean;
    return `${short} ${alert.panelUrl}`.trim();
  };
  if (alert.inbound) {
    return ['te escribió (conversación tomada)', alert.inbound.name, alert.reachAt ?? '—', withLink(alert.inbound.text)].map(templateParam);
  }
  if (alert.booking) {
    const { nombre, email, evento, inicia } = alert.booking;
    const contact = email ?? alert.reachAt ?? 'sin correo';
    return ['cita agendada', nombre, contact, withLink([evento, inicia].filter(Boolean).join(' · '))].map(templateParam);
  }
  const lastUserTurn = alert.transcript.findLast((t) => t.role === 'user')?.content;
  return [
    alert.captured ? 'lead capturado' : 'nuevo interés',
    alert.captured?.nombre ?? 'sin nombre',
    alert.captured?.contacto ?? alert.reachAt ?? `sin contacto (llegó por ${alert.channel})`,
    withLink(alert.captured?.necesidad ?? lastUserTurn),
  ].map(templateParam);
}

async function sendWhatsApp(config: NotifyConfig['whatsapp'], alert: LeadAlert): Promise<void> {
  if (!config?.to) return;
  await sendTemplate({ to: config.to, template: config.template, language: config.language, params: whatsAppAlertParams(alert) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const transcript = [
    { role: 'user' as const, content: 'Quiero un sitio\npara mi   taller' },
    { role: 'assistant' as const, content: '¿Qué tipo de taller?' },
  ];

  assert.deepEqual(
    whatsAppAlertParams({
      channel: 'web',
      contactId: 'x',
      transcript,
      captured: { nombre: 'Ana', contacto: 'ana@x.mx', necesidad: '' },
    }),
    ['lead capturado', 'Ana', 'ana@x.mx', '—'],
    'una variable vacía la rechaza Meta',
  );
  assert.deepEqual(
    whatsAppAlertParams({ channel: 'whatsapp', contactId: '52', transcript, reachAt: '522225551234' }),
    ['nuevo interés', 'sin nombre', '522225551234', 'Quiero un sitio para mi taller'],
    'sin captura, el detalle es lo último que dijo, sin saltos de línea',
  );
  assert.equal(
    whatsAppAlertParams({ channel: 'web', contactId: 'x', transcript })[2],
    'sin contacto (llegó por web)',
  );
  assert.deepEqual(
    whatsAppAlertParams({
      channel: 'calendly',
      contactId: 'x',
      transcript: [],
      booking: { nombre: 'Luis', email: 'l@x.mx', inicia: '2026-10-10T16:00:00Z' },
    }),
    ['cita agendada', 'Luis', 'l@x.mx', '2026-10-10T16:00:00Z'],
  );
  assert.equal(whatsAppAlertParams({ channel: 'web', contactId: 'x', transcript: [{ role: 'user', content: 'a'.repeat(500) }] })[3].length, 200);

  const panel = 'https://negocio.example/panel/conversaciones/5212225551234';
  const inbound = whatsAppAlertParams({
    channel: 'whatsapp', contactId: '5212225551234', transcript, reachAt: '522225551234',
    panelUrl: panel, inbound: { name: 'Ana', text: '¿Sigues ahí? Quiero confirmar la cita del jueves' },
  });
  assert.equal(inbound[0], 'te escribió (conversación tomada)');
  assert.equal(inbound[1], 'Ana');
  assert.ok(inbound[3].endsWith(panel), 'el enlace al panel va completo al final del detalle');
  assert.ok(inbound[3].startsWith('¿Sigues ahí?'));
  const lead = whatsAppAlertParams({ channel: 'web', contactId: 'x', transcript, captured: { nombre: 'Ana', contacto: 'a@x.mx', necesidad: 'web' }, panelUrl: panel });
  assert.ok(lead[3].endsWith(panel), 'los avisos de siempre también traen el enlace');
  assert.ok(lead[3].length <= 200);

  console.log('notify.ts self-check passed');
}

import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import type { Turn } from './engine';
import type { CapturedLead } from './tools';
import type { Booking } from './scheduling/calendly-webhook';
import type { NotifyConfig } from './config/schema';
import { sendTemplate, templateParam, type WhatsAppCredentials } from './channels/whatsapp.ts';

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
/** The client's own keys, handed in by the caller: this file reads no environment. */
export interface NotifySecrets {
  resendApiKey?: string;
  whatsapp?: WhatsAppCredentials;
  /** The client's n8n (or any) endpoint. The URL is a secret: whoever has it can post to the flow. */
  webhook?: { url?: string; secret?: string; clientId: string };
}

export function createLeadNotifier(config: NotifyConfig, secrets: NotifySecrets = {}): LeadNotifier {
  return {
    async notify(alert) {
      // Each channel on its own: a failed WhatsApp send must not cost the email.
      const results = await Promise.allSettled([
        sendEmail(config.email, config.fromEmail, alert, secrets.resendApiKey),
        sendWhatsApp(config.whatsapp, alert, secrets.whatsapp ?? {}),
        sendWebhook(alert, secrets.webhook),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') console.error('lead alert failed', r.reason);
      }
    },
  };
}

/** Resend's plain HTTP API directly; a single POST doesn't need the SDK. */
async function sendEmail(
  to: string | undefined,
  from: string | undefined,
  alert: LeadAlert,
  apiKey: string | undefined,
): Promise<void> {
  if (!to || !from) return;

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

async function sendWhatsApp(config: NotifyConfig['whatsapp'], alert: LeadAlert, creds: WhatsAppCredentials): Promise<void> {
  if (!config?.to) return;
  await sendTemplate({ to: config.to, template: config.template, language: config.language, params: whatsAppAlertParams(alert) }, creds);
}

/** The same order the email subject uses: the most specific thing that happened wins. */
export function alertEvent(alert: LeadAlert): 'inbound' | 'booking' | 'lead' | 'interest' {
  if (alert.inbound) return 'inbound';
  if (alert.booking) return 'booking';
  if (alert.captured) return 'lead';
  return 'interest';
}

// ponytail: no retries — with the flow down the event is lost; add a queue when a client needs one.
async function sendWebhook(alert: LeadAlert, webhook: NotifySecrets['webhook']): Promise<void> {
  if (!webhook?.url) return;
  const body = JSON.stringify({
    event: alertEvent(alert),
    clientId: webhook.clientId,
    channel: alert.channel,
    contactId: alert.contactId,
    at: new Date().toISOString(),
    lead: alert.captured ?? null,
    booking: alert.booking ?? null,
    inbound: alert.inbound ?? null,
    reachAt: alert.reachAt ?? null,
    panelUrl: alert.panelUrl ?? null,
    transcript: alert.transcript,
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (webhook.secret) {
    headers['x-signature-256'] = `sha256=${createHmac('sha256', webhook.secret).update(body).digest('hex')}`;
  }
  // A slow flow must not hold the reply: five seconds, then a log line.
  const res = await fetch(webhook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) });
  if (!res.ok) console.error('webhook error', res.status);
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

  // Webhook: a local receiver stands in for n8n.
  const { createServer } = await import('node:http');
  const received: { body: string; signature?: string }[] = [];
  let mode: 'ok' | 'fail' | 'hang' = 'ok';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ body, signature: req.headers['x-signature-256'] as string | undefined });
      if (mode === 'hang') return;
      res.statusCode = mode === 'fail' ? 500 : 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
  const off: NotifyConfig = {} as NotifyConfig;

  assert.equal(alertEvent({ channel: 'web', contactId: 'x', transcript }), 'interest');
  assert.equal(alertEvent({ channel: 'web', contactId: 'x', transcript, captured: { nombre: 'A', contacto: 'a' } }), 'lead');
  assert.equal(alertEvent({ channel: 'calendly', contactId: 'x', transcript: [], captured: { nombre: 'A', contacto: 'a' }, booking: { nombre: 'A' } }), 'booking');
  assert.equal(alertEvent({ channel: 'whatsapp', contactId: 'x', transcript, booking: { nombre: 'A' }, inbound: { name: 'A', text: 'hola' } }), 'inbound');

  await createLeadNotifier(off, { webhook: { url, secret: 's3cr3t', clientId: 'acme' } }).notify({
    channel: 'whatsapp', contactId: '5212225551234', transcript, reachAt: '522225551234',
    captured: { nombre: 'Ana', contacto: '222 555 1234', necesidad: 'limpieza' },
  });
  assert.equal(received.length, 1);
  const sent = JSON.parse(received[0].body);
  assert.equal(sent.event, 'lead');
  assert.equal(sent.clientId, 'acme');
  assert.equal(sent.channel, 'whatsapp');
  assert.equal(sent.contactId, '5212225551234');
  assert.deepEqual(sent.lead, { nombre: 'Ana', contacto: '222 555 1234', necesidad: 'limpieza' });
  assert.equal(sent.booking, null, 'lo ausente va como null');
  assert.equal(sent.inbound, null);
  assert.equal(sent.panelUrl, null);
  assert.equal(sent.reachAt, '522225551234');
  assert.deepEqual(sent.transcript, transcript);
  assert.ok(!Number.isNaN(Date.parse(sent.at)));
  assert.equal(
    received[0].signature,
    `sha256=${createHmac('sha256', 's3cr3t').update(received[0].body).digest('hex')}`,
    'la firma es del cuerpo crudo que llegó',
  );

  await createLeadNotifier(off, { webhook: { url, clientId: 'acme' } }).notify({ channel: 'web', contactId: 'x', transcript });
  assert.equal(received.length, 2);
  assert.equal(received[1].signature, undefined, 'sin secreto, sin firma');

  await createLeadNotifier(off, { webhook: { clientId: 'acme' } }).notify({ channel: 'web', contactId: 'x', transcript });
  assert.equal(received.length, 2, 'sin URL no hay petición');

  mode = 'fail';
  await createLeadNotifier(off, { webhook: { url, clientId: 'acme' } }).notify({ channel: 'web', contactId: 'x', transcript });
  assert.equal(received.length, 3, 'un 500 no lanza');

  mode = 'hang';
  const t0 = Date.now();
  await createLeadNotifier(off, { webhook: { url, clientId: 'acme' } }).notify({ channel: 'web', contactId: 'x', transcript });
  const waited = Date.now() - t0;
  assert.ok(waited >= 4500 && waited < 7000, `un webhook colgado se corta a los 5 s (tardó ${waited} ms)`);
  server.closeAllConnections();
  server.close();
  console.log('notify.ts self-check passed');
}

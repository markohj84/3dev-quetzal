import assert from 'node:assert';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelAdapter, InboundMessage } from './types';

/**
 * WhatsApp Business Platform (Meta Cloud API).
 *
 * Flattened formatting lives entirely in this file: WhatsApp has bold and
 * italics and nothing else — no headings, no lists, no links with custom
 * labels.
 *
 * Meta's 24h service window is not modelled: the assistant only ever answers
 * an inbound message, which is always inside it. Sending first (reminders,
 * follow-ups) needs an approved template and a last-inbound clock — both
 * were removed unused on 2026-10-06 and live in git history.
 */

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the raw request body.
 * Must run on the raw bytes before JSON.parse — a re-serialized body won't
 * match byte-for-byte and would always fail.
 */
export function verifySignature(appSecret: string, rawBody: string, header: string | null): boolean {
  // An unset secret would make an empty-key HMAC the valid one, and anyone can
  // compute that. A deploy missing it must reject everything, not accept forgeries.
  if (!appSecret || !header?.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = header.slice('sha256='.length);

  const expectedBuf = Buffer.from(expected, 'hex');
  const givenBuf = Buffer.from(given, 'hex');
  if (expectedBuf.length !== givenBuf.length) return false;

  return timingSafeEqual(expectedBuf, givenBuf);
}

export function createWhatsAppAdapter(opts: {
  phoneNumberId: string;
  accessToken: string;
}): ChannelAdapter {
  return {
    name: 'whatsapp',

    capabilities: {
      maxLength: 4096,
      maxChips: 3,
      markup: 'whatsapp',
      stableContactId: true,
    },

    parse(payload: unknown): InboundMessage | null {
      const value = (payload as any)?.entry?.[0]?.changes?.[0]?.value;
      // Meta accepts a send and only reports a failed delivery later, here.
      // Without this log a lost reply or lead alert leaves no trace.
      for (const failed of failedDeliveries(payload)) {
        console.warn(`[whatsapp] entrega fallida a ${failed.recipient}: ${failed.error}`);
      }
      const msg = value?.messages?.[0];
      if (!msg) return null;

      // One Meta app hears every number subscribed to it, but deliver() always
      // answers from opts.phoneNumberId. A message to any other number would
      // get its reply from ours, in a separate chat — so each deployment
      // speaks only for its own number and leaves the rest alone.
      const to = value?.metadata?.phone_number_id;
      if (opts.phoneNumberId && to && to !== opts.phoneNumberId) {
        console.warn(`[whatsapp] ignorado: llegó al número ${to}, este despliegue atiende ${opts.phoneNumberId}`);
        return null;
      }

      const text =
        msg.text?.body ??
        msg.interactive?.button_reply?.title ??
        msg.interactive?.list_reply?.title ??
        mediaNote(msg);
      if (!text) return null;

      return {
        contactId: msg.from,
        text,
        receivedAt: new Date(Number(msg.timestamp) * 1000),
        displayName: value?.contacts?.[0]?.profile?.name || undefined,
        id: msg.id,
      };
    },

    async deliver(to, message) {
      const recipient = toMetaRecipient(to);
      const body = toWhatsAppMarkup(message.text);
      const chips = (message.chips ?? []).slice(0, 3);

      const payload = chips.length
        ? {
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'interactive',
            interactive: {
              type: 'button',
              body: { text: body },
              action: {
                buttons: chips.map((title, i) => ({
                  type: 'reply',
                  reply: { id: `chip_${i}`, title: title.slice(0, 20) },
                })),
              },
            },
          }
     : {
      messaging_product: 'whatsapp',
      to: recipient,      // ← antes decía solo "to,"
      type: 'text',
      text: { body },
    };
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${opts.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        throw new Error(`WhatsApp delivery failed: ${res.status} ${await res.text()}`);
      }
    },
  };
}

/** The sends Meta accepted and later reported as never delivered: who each was for, and why. */
export function failedDeliveries(payload: unknown): { recipient: string; error: string }[] {
  const statuses: any[] = (payload as any)?.entry?.[0]?.changes?.[0]?.value?.statuses ?? [];
  return statuses
    .filter((status) => status?.status === 'failed')
    .map((status) => {
      const { code, title, error_data } = status.errors?.[0] ?? {};
      const reason = [code, title].filter(Boolean).join(' ') || 'sin detalle';
      return { recipient: String(status.recipient_id ?? ''), error: error_data?.details ? `${reason}: ${error_data.details}` : reason };
    });
}

/**
 * Coexistence: the owner keeps the WhatsApp Business app on the same number,
 * and what they send from it comes back here as an echo. Each echo is the
 * owner answering that person, so the assistant has to step aside or both talk
 * at once. Every kind counts, a reaction too: it says the owner is in the chat.
 */
export function ownerEchoes(payload: unknown): { contactId: string; text: string; id: string }[] {
  const value = (payload as any)?.entry?.[0]?.changes?.[0]?.value;
  const echoes: any[] = value?.message_echoes ?? [];
  // The wa_id is the id the person's own messages arrive from (521… for Mexican
  // mobiles); `to` is only the number. With one echo, contacts is that person.
  const waId = echoes.length === 1 ? value?.contacts?.[0]?.wa_id : undefined;
  return echoes.flatMap((echo) => {
    const contactId = waId ?? echo.to;
    if (!contactId) return [];
    const kind = Object.keys(MEDIA).find((k) => echo[k]);
    const text = echo.text?.body ?? (kind ? `[Envió ${MEDIA[kind]} desde el celular del negocio.]` : `[Respondió desde el celular del negocio (${echo.type}).]`);
    return [{ contactId: String(contactId), text, id: String(echo.id ?? '') }];
  });
}

// A sticker or a reaction is a gesture, and silence is the right answer to it: neither is here.
const MEDIA: Record<string, string> = {
  audio: 'un audio',
  image: 'una imagen',
  video: 'un video',
  document: 'un documento',
  location: 'su ubicación',
  contacts: 'un contacto',
};

/**
 * Voice notes and photos are how people write here, and the assistant only
 * reads text. Rather than leave them unanswered, the turn says what arrived:
 * the reply is still the assistant's, in its own voice, and the owner reads
 * the same line in the transcript. A caption is the person's own words.
 */
function mediaNote(msg: any): string | undefined {
  const kind = Object.keys(MEDIA).find((k) => msg[k]);
  if (!kind) return undefined;
  const caption = typeof msg[kind].caption === 'string' ? msg[kind].caption.trim() : '';
  return caption
    ? `${caption}\n\n[Con este mensaje envió ${MEDIA[kind]}. El asistente solo lee texto.]`
    : `[Envió ${MEDIA[kind]}. El asistente solo lee texto: hay que pedirle que lo escriba.]`;
}

/** Strips markup the channel cannot render rather than showing it raw. */
function toWhatsAppMarkup(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^[-*]\s+/gm, '• ')
    .trim();
}

/**
 * WhatsApp reports Mexican mobiles as 521XXXXXXXXXX (legacy "1"),
 * but the Cloud API only delivers to 52XXXXXXXXXX. Normalize before sending.
 */
export function toMetaRecipient(waId: string): string {
  return /^521\d{10}$/.test(waId) ? `52${waId.slice(3)}` : waId;
}

/**
 * Template variables can't carry newlines, tabs or long runs of spaces, and
 * Meta rejects an empty one — so every value is flattened and never blank.
 */
export function templateParam(value: string | undefined): string {
  const flat = (value ?? '').replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, 200) : '—';
}

/**
 * The only way to write first: a Meta-approved template. Returns the wa_id
 * Meta resolved the number to — the id a reply will come back from, which
 * for Mexican mobiles is not the number we sent to.
 */
/** One client's own number and token: never read from the environment here, or a shared deploy would send from the wrong number. */
export interface WhatsAppCredentials {
  phoneNumberId?: string;
  token?: string;
}

export async function sendTemplate(
  msg: {
    to: string;
    template: string;
    language: string;
    params: string[];
  },
  creds: WhatsAppCredentials,
): Promise<string | undefined> {
  const { phoneNumberId, token } = creds;
  if (!phoneNumberId || !token) throw new Error('WhatsApp no configurado');

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: msg.to,
      type: 'template',
      template: {
        name: msg.template,
        language: { code: msg.language },
        components: [{ type: 'body', parameters: msg.params.map((p) => ({ type: 'text', text: templateParam(p) })) }],
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`WhatsApp template ${msg.template} failed: ${res.status} ${await res.text()}`);

  const body = (await res.json()) as { contacts?: { wa_id?: string }[] };
  return body.contacts?.[0]?.wa_id;
}

// Self-check: `node core/channels/whatsapp.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = 'test-secret';
  const body = '{"hello":"world"}';
  const goodSig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

  assert.ok(verifySignature(secret, body, goodSig), 'valid signature should pass');
  assert.ok(!verifySignature(secret, body, 'sha256=' + '0'.repeat(64)), 'wrong signature should fail');
  assert.ok(!verifySignature(secret, body, null), 'missing header should fail');
  assert.ok(!verifySignature(secret, body, 'not-sha256=abc'), 'wrong prefix should fail');
  assert.ok(!verifySignature('other-secret', body, goodSig), 'wrong secret should fail');
  const emptyKeySig = 'sha256=' + createHmac('sha256', '').update(body).digest('hex');
  assert.ok(!verifySignature('', body, emptyKeySig), 'an unset secret should reject even a matching empty-key signature');

  assert.equal(toMetaRecipient('5212223334455'), '522223334455', 'legacy 521 should drop the 1');
  assert.equal(toMetaRecipient('522223334455'), '522223334455', 'plain 52 should pass through');
  assert.equal(toMetaRecipient('14155552671'), '14155552671', 'non-MX should pass through');

  const adapter = createWhatsAppAdapter({
    phoneNumberId: '1',
    accessToken: 'x',
  });
  const inbound = (msg: unknown, phoneNumberId = '1') => ({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [msg] } }] }],
  });

  const texto = adapter.parse(inbound({ from: '5212223334455', text: { body: 'hola' }, timestamp: '1790000000' }));
  assert.equal(texto?.text, 'hola');
  assert.equal(texto?.contactId, '5212223334455', 'el contactId conserva el wa_id tal cual');
  assert.equal(texto?.receivedAt.getTime(), 1790000000 * 1000, 'el timestamp de Meta viene en segundos');
  assert.equal(texto?.displayName, undefined, 'sin contacts no hay nombre de perfil');
  assert.equal(
    adapter.parse(inbound({ id: 'wamid.HBgM', from: '52', text: { body: 'hola' }, timestamp: '1' }))?.id,
    'wamid.HBgM',
    'el id de Meta es lo que distingue una segunda entrega del mismo mensaje',
  );
  assert.equal(
    adapter.parse({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: '1' },
      contacts: [{ profile: { name: 'Laura' }, wa_id: '52' }],
      messages: [{ from: '52', text: { body: 'hola' }, timestamp: '1' }],
    } }] }] })?.displayName,
    'Laura',
    'Meta manda el nombre de perfil en contacts, no en messages',
  );

  // Los chips regresan por interactive, no por text: si esto se rompe, el
  // asistente deja de oír justo a quien le contestó con un botón.
  assert.equal(
    adapter.parse(inbound({ from: '52', interactive: { button_reply: { title: 'Sí, agendar' } }, timestamp: '1' }))?.text,
    'Sí, agendar',
  );
  assert.equal(
    adapter.parse(inbound({ from: '52', interactive: { list_reply: { title: 'Oferta 1' } }, timestamp: '1' }))?.text,
    'Oferta 1',
  );

  assert.equal(adapter.parse({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), null, 'un acuse no es mensaje');
  // Meta accepts a send and says later, in a receipt, that it never arrived: the only notice there is.
  const receipts = { entry: [{ changes: [{ value: { metadata: { phone_number_id: '1' }, statuses: [
    { status: 'delivered', recipient_id: '522220000001' },
    { status: 'failed', recipient_id: '522225551234', errors: [{ code: 131042, title: 'Business eligibility payment issue', error_data: { details: 'There were one or more errors related to your payment method.' } }] },
    { status: 'failed', recipient_id: '522225559999', errors: [{ code: 131026, title: 'Message undeliverable' }] },
  ] } }] }] };
  assert.deepEqual(failedDeliveries(receipts), [
    { recipient: '522225551234', error: '131042 Business eligibility payment issue: There were one or more errors related to your payment method.' },
    { recipient: '522225559999', error: '131026 Message undeliverable' },
  ]);
  assert.deepEqual(failedDeliveries(inbound({ from: '52', text: { body: 'hola' }, timestamp: '1' })), [], 'un mensaje no trae entregas fallidas');
  assert.deepEqual(failedDeliveries(null), []);
  // Voice notes and photos are how people write on WhatsApp: a turn the assistant answers, not silence.
  const audio = adapter.parse(inbound({ from: '52', type: 'audio', audio: { id: 'a1', voice: true }, timestamp: '1' }));
  assert.match(audio?.text ?? '', /^\[Envió un audio\. /, 'un audio es un turno: el asistente contesta que solo lee texto');
  const foto = adapter.parse(inbound({ from: '52', type: 'image', image: { id: 'i1', caption: '¿Tienen este modelo?' }, timestamp: '1' }));
  assert.ok(foto?.text.startsWith('¿Tienen este modelo?'), 'el pie de foto es lo que la persona escribió');
  assert.match(foto?.text ?? '', /envió una imagen/, 'y se dice que venía con una imagen');
  assert.equal(adapter.parse(inbound({ from: '52', type: 'sticker', sticker: { id: 's1' }, timestamp: '1' })), null, 'un sticker es un gesto: no pide respuesta');
  assert.equal(adapter.parse(inbound({ from: '52', type: 'reaction', reaction: { emoji: '👍' }, timestamp: '1' })), null, 'una reacción tampoco');
  assert.equal(adapter.parse(null), null);

  // Otro número de la misma app: no es nuestro turno. Si contestáramos, la
  // respuesta saldría de nuestro número en un chat aparte.
  const originalWarn = console.warn;
  console.warn = () => {};
  assert.equal(
    adapter.parse(inbound({ from: '52', text: { body: 'hola' }, timestamp: '1' }, 'otro-numero')),
    null,
    'un mensaje a otro número de la app se ignora',
  );
  console.warn = originalWarn;
  assert.equal(
    adapter.parse({ entry: [{ changes: [{ value: { messages: [{ from: '52', text: { body: 'hola' }, timestamp: '1' }] } }] }] })?.text,
    'hola',
    'sin metadata no se descarta: solo un desacuerdo explícito bloquea',
  );

  assert.equal(toWhatsAppMarkup('## Título\n**negritas**\n- uno'), 'Título\n*negritas*\n• uno');

  const echo = (echoes: object[], contacts?: object[]) => ({ entry: [{ changes: [{ field: 'smb_message_echoes', value: { contacts, message_echoes: echoes } }] }] });
  assert.deepEqual(
    ownerEchoes(echo([{ from: '522214100378', to: '522225550101', id: 'wamid.1', type: 'text', text: { body: 'Hola, soy Ana' } }], [{ wa_id: '5212225550101' }])),
    [{ contactId: '5212225550101', text: 'Hola, soy Ana', id: 'wamid.1' }],
    'el id es el wa_id, el mismo con el que llegan los mensajes de la persona, no el número del `to`',
  );
  assert.equal(ownerEchoes(echo([{ to: '522225550101', id: 'w', type: 'text', text: { body: 'ok' } }]))[0].contactId, '522225550101', 'sin contacts, el `to`');
  assert.match(ownerEchoes(echo([{ to: '52', id: 'w', type: 'image', image: { id: 'x' } }]))[0].text, /una imagen/);
  assert.equal(ownerEchoes(echo([{ to: '52', id: 'w', type: 'reaction', reaction: { emoji: '👍' } }])).length, 1, 'una reacción también dice que el dueño está en el chat');
  assert.deepEqual(ownerEchoes(echo([{ id: 'w', type: 'text', text: { body: 'a nadie' } }])), [], 'sin destinatario no hay conversación que tomar');
  assert.deepEqual(ownerEchoes({ entry: [{ changes: [{ value: { messages: [{ from: '52', text: { body: 'hola' } }] } }] }] }), []);

  console.log('whatsapp.ts self-check passed');
}

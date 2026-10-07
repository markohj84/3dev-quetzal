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
    },

    parse(payload: unknown): InboundMessage | null {
      const value = (payload as any)?.entry?.[0]?.changes?.[0]?.value;
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
        msg.interactive?.list_reply?.title;
      if (!text) return null;

      return {
        contactId: msg.from,
        text,
        receivedAt: new Date(Number(msg.timestamp) * 1000),
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
function toMetaRecipient(waId: string): string {
  return /^521\d{10}$/.test(waId) ? `52${waId.slice(3)}` : waId;
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
  assert.equal(adapter.parse(inbound({ from: '52', image: {}, timestamp: '1' })), null, 'una imagen sin texto no es turno');
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

  console.log('whatsapp.ts self-check passed');
}

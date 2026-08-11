import type { ChannelAdapter, InboundMessage } from './types';

/**
 * WhatsApp Business Platform (Meta Cloud API).
 *
 * Two constraints live entirely in this file and must not leak upward:
 *
 *   1. The 24h service window. Outside it, only Meta-approved templates
 *      may be sent. The engine does not know this exists.
 *   2. Flattened formatting. WhatsApp has bold and italics and nothing
 *      else — no headings, no lists, no links with custom labels.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function createWhatsAppAdapter(opts: {
  phoneNumberId: string;
  accessToken: string;
  /** Returns the timestamp of the contact's last inbound message. */
  lastInboundAt: (contactId: string) => Promise<Date | null>;
}): ChannelAdapter {
  return {
    name: 'whatsapp',

    capabilities: {
      maxLength: 4096,
      maxChips: 3,
      hasSendWindow: true,
      markup: 'whatsapp',
    },

    parse(payload: unknown): InboundMessage | null {
      const value = (payload as any)?.entry?.[0]?.changes?.[0]?.value;
      const msg = value?.messages?.[0];
      if (!msg) return null;

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

    async canSendFreely(contactId) {
      const last = await opts.lastInboundAt(contactId);
      if (!last) return false;
      return Date.now() - last.getTime() < WINDOW_MS;
    },

    async deliver(to, message) {
      const body = toWhatsAppMarkup(message.text);
      const chips = (message.chips ?? []).slice(0, 3);

      const payload = chips.length
        ? {
            messaging_product: 'whatsapp',
            to,
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
            to,
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

import assert from 'node:assert';
import type { ChannelAdapter, InboundMessage } from './types';

/**
 * The embedded widget. Richer formatting, chips render
 * as inline pills. Delivery is a no-op because the HTTP response is the
 * transport — the route returns the reply directly.
 */
export function createWebAdapter(): ChannelAdapter {
  return {
    name: 'web',

    capabilities: {
      maxLength: 4000,
      maxChips: 4,
      markup: 'html',
      stableContactId: false,
    },

    parse(payload: unknown): InboundMessage | null {
      const { sessionId, text } = (payload ?? {}) as Record<string, unknown>;
      if (typeof sessionId !== 'string' || typeof text !== 'string' || !text.trim()) {
        return null;
      }
      // WhatsApp contact ids are phone numbers and share the session and the log:
      // a web id that is one would read, and write into, that person's thread.
      if (!sessionId || sessionId.length > 100 || /^\+?\d+$/.test(sessionId)) return null;
      return { contactId: sessionId, text: text.trim(), receivedAt: new Date() };
    },

    async deliver() {
      /* the route returns the reply in its response */
    },
  };
}

// Self-check: `node core/channels/web.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const web = createWebAdapter();
  assert.equal(web.parse({ sessionId: crypto.randomUUID(), text: 'hola' })?.text, 'hola');
  assert.equal(web.parse({ sessionId: 'eval-3-1792509490', text: 'hola' })?.contactId, 'eval-3-1792509490');
  // WhatsApp contact ids are phone numbers: a web id that looks like one would read that person's thread.
  assert.equal(web.parse({ sessionId: '5212225551234', text: 'hola' }), null, 'un id de puros dígitos es de WhatsApp');
  assert.equal(web.parse({ sessionId: '+5212225551234', text: 'hola' }), null);
  assert.equal(web.parse({ sessionId: 'x'.repeat(200), text: 'hola' }), null, 'un id larguísimo no es de un widget');
  assert.equal(web.parse({ sessionId: '', text: 'hola' }), null);
  console.log('web.ts self-check passed');
}

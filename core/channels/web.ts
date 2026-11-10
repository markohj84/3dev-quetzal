import assert from 'node:assert';
import type { ChannelAdapter, InboundMessage } from './types';

/**
 * More than anyone types by hand. The endpoint is public, and an uncapped
 * message is paid for in tokens on that turn and on every one after it.
 */
const MAX_TEXT = 4000;

/** A cut between the two halves of an emoji would leave a lone surrogate the model API may reject. */
function clip(text: string): string {
  const cut = text.slice(0, MAX_TEXT);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

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
      return { contactId: sessionId, text: clip(text.trim()), receivedAt: new Date() };
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
  // Anyone can post to the chat: what nobody types by hand is cut before it is paid for in tokens.
  assert.equal(web.parse({ sessionId: 'x1', text: 'a'.repeat(10_000) })?.text.length, 4000, 'un mensaje larguísimo se recorta');
  assert.equal(web.parse({ sessionId: 'x1', text: 'a'.repeat(3999) + '😀' })?.text, 'a'.repeat(3999), 'el corte no deja medio emoji');
  assert.equal(web.parse({ sessionId: 'x1', text: 'a'.repeat(3998) + '😀' })?.text, 'a'.repeat(3998) + '😀', 'un emoji que cabe entero se queda');
  console.log('web.ts self-check passed');
}

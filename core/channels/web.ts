import type { ChannelAdapter, InboundMessage } from './types';

/**
 * The embedded widget. No send window, richer formatting, chips render
 * as inline pills. Delivery is a no-op because the HTTP response is the
 * transport — the route returns the reply directly.
 */
export function createWebAdapter(): ChannelAdapter {
  return {
    name: 'web',

    capabilities: {
      maxLength: 4000,
      maxChips: 4,
      hasSendWindow: false,
      markup: 'html',
    },

    parse(payload: unknown): InboundMessage | null {
      const { sessionId, text } = (payload ?? {}) as Record<string, unknown>;
      if (typeof sessionId !== 'string' || typeof text !== 'string' || !text.trim()) {
        return null;
      }
      return { contactId: sessionId, text: text.trim(), receivedAt: new Date() };
    },

    async canSendFreely() {
      return true;
    },

    async deliver() {
      /* the route returns the reply in its response */
    },
  };
}

import { Redis } from '@upstash/redis';
import type { ConversationState } from '../engine';

/** Names match what Vercel's Upstash Marketplace integration injects, not @upstash/redis's own convention. */
const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

/** Matches WhatsApp's 24h service window — a session stale past that is dead either way. */
const SESSION_TTL_SECONDS = 60 * 60 * 24;

export interface SessionStore {
  get(contactId: string): Promise<ConversationState | null>;
  set(contactId: string, state: ConversationState): Promise<void>;
}

export function createSessionStore(): SessionStore {
  return {
    async get(contactId) {
      return (await kv.get<ConversationState>(`session:${contactId}`)) ?? null;
    },
    async set(contactId, state) {
      await kv.set(`session:${contactId}`, state, { ex: SESSION_TTL_SECONDS });
    },
  };
}

/** Tracks last-inbound timestamps per contact, e.g. for a channel's send-window check. */
export interface InboundClock {
  get(contactId: string): Promise<Date | null>;
  set(contactId: string, at: Date): Promise<void>;
}

export function createInboundClock(): InboundClock {
  return {
    async get(contactId) {
      const iso = await kv.get<string>(`last-inbound:${contactId}`);
      return iso ? new Date(iso) : null;
    },
    async set(contactId, at) {
      await kv.set(`last-inbound:${contactId}`, at.toISOString(), { ex: SESSION_TTL_SECONDS });
    },
  };
}

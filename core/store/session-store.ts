import { Redis } from '@upstash/redis';
import type { ConversationState } from '../engine';
import { isMultiTenant } from '../config/env';

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

/** Keyed by client too: in a shared deploy two clients can meet the same phone number or session id. */
export const sessionKey = (clientId: string, contactId: string) => `session:${clientId}:${contactId}`;

export function createSessionStore(clientId: string): SessionStore {
  return {
    async get(contactId) {
      const own = await kv.get<ConversationState>(sessionKey(clientId, contactId));
      if (own) return own;
      // ponytail: sessions opened before the key carried the client; a project of one client still owns them.
      // Without this a person mid-conversation at deploy time is offered the meeting a second time.
      // Delete after one release (sessions last 24 h).
      return isMultiTenant() ? null : ((await kv.get<ConversationState>(`session:${contactId}`)) ?? null);
    },
    async set(contactId, state) {
      await kv.set(sessionKey(clientId, contactId), state, { ex: SESSION_TTL_SECONDS });
    },
  };
}

const BUSY_SECONDS = 5 * 60;
const DONE_SECONDS = 60 * 60 * 24;
const inboundKey = (clientId: string, messageId: string) => `inbound:${clientId}:${messageId}`;

/**
 * A webhook delivers at least once: the same message comes again when the
 * first delivery took long or failed. 'new' the first time, 'busy' while that
 * delivery is still being handled, 'done' once it finished. The busy mark
 * lapses on its own, so a delivery that died is handled when it comes back.
 */
export async function claimMessage(clientId: string, messageId: string): Promise<'new' | 'busy' | 'done'> {
  const key = inboundKey(clientId, messageId);
  if (await kv.set(key, 'busy', { nx: true, ex: BUSY_SECONDS })) return 'new';
  return (await kv.get<string>(key)) === 'done' ? 'done' : 'busy';
}

export async function finishMessage(clientId: string, messageId: string): Promise<void> {
  await kv.set(inboundKey(clientId, messageId), 'done', { ex: DONE_SECONDS });
}

export interface RateLimiter {
  /** True if this call is within limit; false if the caller should be rejected. */
  check(key: string): Promise<boolean>;
}

/** Fixed-window counter: `limit` calls per `windowSeconds`, per key. */
export function createRateLimiter(limit: number, windowSeconds: number): RateLimiter {
  return {
    async check(key) {
      const window = Math.floor(Date.now() / 1000 / windowSeconds);
      const bucket = `ratelimit:${key}:${window}`;
      const count = await kv.incr(bucket);
      if (count === 1) await kv.expire(bucket, windowSeconds);
      return count <= limit;
    },
  };
}

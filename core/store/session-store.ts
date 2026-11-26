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

/** Keyed by client too: in a shared deploy two clients can meet the same phone number or session id. */
export const sessionKey = (clientId: string, contactId: string) => `session:${clientId}:${contactId}`;

export function createSessionStore(clientId: string): SessionStore {
  return {
    async get(contactId) {
      return (await kv.get<ConversationState>(sessionKey(clientId, contactId))) ?? null;
    },
    async set(contactId, state) {
      await kv.set(sessionKey(clientId, contactId), state, { ex: SESSION_TTL_SECONDS });
    },
  };
}

// A turn held longer than this has died, and the next one stops waiting for it.
const TURN_SECONDS = 90;
const TURN_WAIT_MS = 30_000;

/**
 * One conversation, one reply at a time. People write in bursts, and two
 * messages answered at once each read the thread without the other: the later
 * write erases the earlier exchange, and the one-offer rule is checked against
 * a state that is already stale. The second waits for the first. If the first
 * never finishes, or the lock cannot be taken at all, it goes ahead anyway:
 * an answer out of turn beats no answer.
 */
export async function withTurn<T>(clientId: string, contactId: string, reply: () => Promise<T>): Promise<T> {
  const key = `turn:${clientId}:${contactId}`;
  const mine = crypto.randomUUID();
  const giveUp = Date.now() + TURN_WAIT_MS;
  let held = false;
  try {
    let pause = 250;
    while (!(held = (await kv.set(key, mine, { nx: true, ex: TURN_SECONDS })) === 'OK') && Date.now() < giveUp) {
      await new Promise((resolve) => setTimeout(resolve, pause));
      // Up to a second between tries: a full wait costs ~30 calls to Redis, not 120,
      // so a burst sent to one conversation cannot turn into a flood of them.
      pause = Math.min(pause * 2, 1000);
    }
  } catch (error) {
    console.error(`[${clientId}] turn lock failed`, error);
  }
  try {
    return await reply();
  } finally {
    // Only our own mark: one that lapsed and was taken by a later turn is theirs to release.
    if (held) {
      await kv
        .eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", [key], [mine])
        .catch((error) => console.error(`[${clientId}] turn release failed`, error));
    }
  }
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

/** All contenders for one invitation compete for the same key across function instances. */
export function quoteBinding(clientId: string, digest: string, expiresAt: number) {
  const key = `quote-binding:${process.env.VERCEL_ENV || 'local'}:${clientId}:${digest}`;
  return {
    owner: () => kv.get<string>(key),
    claim: async (chat: string) => (await kv.set(key, chat, { nx: true, exat: expiresAt + 60 })) === 'OK',
  };
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

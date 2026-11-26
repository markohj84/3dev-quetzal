import { kv, SESSION_TTL_SECONDS } from './session-store.ts';
import { isLegacyOrderFolio, type Order, type OrderBook } from '../channels/order-pilot.ts';

const compareAndSet = `
  local current = redis.call('HGET', KEYS[1], ARGV[4]) or '0'
  if current ~= ARGV[1] then return 0 end
  redis.call('HSET', KEYS[1], ARGV[4], tonumber(current) + 1, ARGV[5], ARGV[2])
  redis.call('EXPIREAT', KEYS[1], ARGV[3])
  return 1
`;

// The chat digest already includes the invitation. Keep the exact choice shown across webhook calls.
export function orderMenuStore(clientId: string, chatDigest: string, pilotExpiresAt: number) {
  const key = ['quote-order-menu', process.env.VERCEL_ENV || 'local', clientId, chatDigest].join(':');
  return {
    newest: () => kv.get<string>(key),
    clear: () => kv.del(key),
    remember(folio: string) {
      const expiresAt = Math.min(pilotExpiresAt, Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
      return kv.set(key, folio, { exat: expiresAt });
    },
  };
}

export function orderStore(clientId: string, binding: string, expiresAt: number): OrderBook {
  const key = ['quote-order', process.env.VERCEL_ENV || 'local', clientId, binding].join(':');
  return {
    async list() {
      const rows = await kv.hgetall<Record<string, Order | number>>(key) ?? {};
      return Object.entries(rows)
        .filter(([field]) => field === 'order' || field.startsWith('order:'))
        .map(([, value]) => value as Order)
        .sort((a,b) => b.created.localeCompare(a.created) || b.folio.localeCompare(a.folio));
    },
    forFolio(folio) {
      // The original pilot stored one order and revision directly on the hash.
      const suffix = isLegacyOrderFolio(folio) ? '' : ':' + folio;
      const field = 'order' + suffix;
      return {
        async read() {
          const row = await kv.hget<Order>(key, field);
          return row?.folio === folio ? row : null;
        },
        async save(revision, next) {
          if (next.folio !== folio) throw new Error('El folio no corresponde al pedido.');
          return await kv.eval(compareAndSet, [key], [revision, JSON.stringify(next), expiresAt, 'revision' + suffix, field]) === 1;
        },
      };
    },
  };
}

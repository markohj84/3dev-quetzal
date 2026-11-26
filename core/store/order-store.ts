import { kv } from './session-store.ts';
import type { Order, OrderStore } from '../channels/order-pilot.ts';

const compareAndSet = `
  local current = redis.call('HGET', KEYS[1], 'revision') or '0'
  if current ~= ARGV[1] then return 0 end
  redis.call('HSET', KEYS[1], 'revision', tonumber(current) + 1, 'order', ARGV[2])
  redis.call('EXPIREAT', KEYS[1], ARGV[3])
  return 1
`;

export function orderStore(clientId: string, binding: string, expiresAt: number): OrderStore {
  const key = ['quote-order', process.env.VERCEL_ENV || 'local', clientId, binding].join(':');
  return {
    read: () => kv.hget<Order>(key, 'order'),
    save: async (revision, next) =>
      await kv.eval(compareAndSet, [key], [revision, JSON.stringify(next), expiresAt]) === 1,
  };
}

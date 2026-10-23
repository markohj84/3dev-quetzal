import assert from 'node:assert';

/** USD per million tokens. Cache reads cost 0.1x the input rate, 5-minute cache writes 1.25x. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Dollars for these tokens, or null when the model has no price here: tokens without a price, never a wrong number. */
export function costUsd(model: string, usage: TokenUsage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.input * 0.1 +
      usage.cacheWrite * price.input * 1.25) /
    1_000_000
  );
}

export interface TokenRow extends TokenUsage {
  model: string;
}

/** A client's total: dollars when every model has a price, and always the token count. */
export function clientCost(rows: TokenRow[]): { usd: number | null; tokens: number } {
  let usd: number | null = 0;
  let tokens = 0;
  for (const row of rows) {
    tokens += row.input + row.output + row.cacheRead + row.cacheWrite;
    const cost = costUsd(row.model, row);
    usd = usd === null || cost === null ? null : usd + cost;
  }
  return { usd, tokens };
}

// Self-check: `node app/admin/pricing.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const one = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
  assert.equal(costUsd('claude-haiku-5-5', one), 0.1);
  assert.equal(costUsd('claude-haiku-5-5', { ...one, input: 0, output: 1_000_000 }), 0.5);
  assert.equal(costUsd('claude-haiku-4-5-20251001', one), 1);
  assert.ok(Math.abs(costUsd('claude-haiku-5-5', { ...one, input: 0, cacheRead: 1_000_000 })! - 0.01) < 1e-9, 'caché leída a 0.1x');
  assert.ok(Math.abs(costUsd('claude-haiku-5-5', { ...one, input: 0, cacheWrite: 1_000_000 })! - 0.125) < 1e-9, 'caché escrita a 1.25x');
  assert.equal(costUsd('modelo-desconocido', one), null, 'sin precio no se inventa uno');
  assert.equal(costUsd('claude-haiku-5-5', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), 0);
  const rows = [
    { model: 'claude-haiku-5-5', input: 1_000_000, output: 200_000, cacheRead: 0, cacheWrite: 0 },
    { model: 'claude-haiku-4-5-20251001', input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 },
  ];
  const total = clientCost(rows);
  assert.ok(Math.abs(total.usd! - (0.1 + 0.1 + 0.1)) < 1e-9, 'suma de modelos distintos');
  assert.equal(total.tokens, 1_300_000);
  const mixed = clientCost([...rows, { model: 'raro', input: 10, output: 0, cacheRead: 0, cacheWrite: 0 }]);
  assert.equal(mixed.usd, null, 'si un modelo no tiene precio no se da un total engañoso');
  assert.equal(mixed.tokens, 1_300_010);
  assert.deepEqual(clientCost([]), { usd: 0, tokens: 0 }, 'sin uso: cero');

  console.log('pricing.ts self-check passed');
}

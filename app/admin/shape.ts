import assert from 'node:assert';

export type Activity = 'activo' | 'quieto' | 'sin actividad';

const HOUR = 3600_000;

/** Active within 3 days, quiet within 14, otherwise nobody has written in a while. */
export function activity(lastAt: string | null, now: Date): Activity {
  if (!lastAt) return 'sin actividad';
  const hours = (now.getTime() - new Date(lastAt).getTime()) / HOUR;
  return hours <= 72 ? 'activo' : hours <= 14 * 24 ? 'quieto' : 'sin actividad';
}

export function sinceLabel(lastAt: string | null, now: Date): string {
  if (!lastAt) return 'nunca';
  const hours = (now.getTime() - new Date(lastAt).getTime()) / HOUR;
  if (hours < 1) return 'hace unos minutos';
  if (hours < 24) return `hace ${Math.floor(hours)} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

/**
 * People who wrote in a calendar month against what the client's plan
 * includes. Past it the assistant keeps answering and the excess is billed in
 * blocks the size of the plan: one person over already opens a block.
 */
export function monthUsage(people: number, limit?: number): string {
  if (!limit) return String(people);
  const blocks = Math.max(0, Math.ceil((people - limit) / limit));
  return `${people} de ${limit}` + (blocks ? ` (${blocks} ${blocks === 1 ? 'bloque' : 'bloques'} extra)` : '');
}

// Self-check: `node app/admin/shape.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const now = new Date('2026-10-24T12:00:00Z');
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();
  assert.equal(activity(ago(2), now), 'activo');
  assert.equal(activity(ago(72), now), 'activo', 'a los 3 días justos sigue activo');
  assert.equal(activity(ago(73), now), 'quieto');
  assert.equal(activity(ago(14 * 24), now), 'quieto');
  assert.equal(activity(ago(14 * 24 + 1), now), 'sin actividad');
  assert.equal(activity(null, now), 'sin actividad', 'nunca escribió nadie');

  assert.equal(sinceLabel(null, now), 'nunca');
  assert.equal(sinceLabel(ago(0.2), now), 'hace unos minutos');
  assert.equal(sinceLabel(ago(5), now), 'hace 5 h');
  assert.equal(sinceLabel(ago(24 * 3), now), 'hace 3 días');
  assert.equal(sinceLabel(ago(24), now), 'hace 1 día');

  assert.equal(monthUsage(12), '12', 'sin plan, solo la cuenta');
  assert.equal(monthUsage(12, 300), '12 de 300');
  assert.equal(monthUsage(300, 300), '300 de 300', 'justo el plan no es excedente');
  assert.equal(monthUsage(301, 300), '301 de 300 (1 bloque extra)', 'una persona de más ya abre un bloque');
  assert.equal(monthUsage(600, 300), '600 de 300 (1 bloque extra)');
  assert.equal(monthUsage(601, 300), '601 de 300 (2 bloques extra)');
  console.log('admin/shape.ts self-check passed');
}

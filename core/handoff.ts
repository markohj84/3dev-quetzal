import assert from 'node:assert';

export const HANDOFF_HOURS = 4;
export const NOTIFY_EVERY_MINUTES = 15;
export const WINDOW_HOURS = 24;

export interface Handoff {
  client_id: string;
  contact_id: string;
  taken_by: string;
  taken_by_email: string;
  taken_at: string;
  last_human_at: string;
  notified_at: string | null;
}

const HOUR_MS = 3600_000;

/** Taken while the owner keeps writing; four quiet hours hand it back, so nobody talks to a silent chat. */
export function isTaken(h: Handoff | null, now: Date): boolean {
  return !!h && now.getTime() - new Date(h.last_human_at).getTime() < HANDOFF_HOURS * HOUR_MS;
}

export function returnsAt(h: Handoff): Date {
  return new Date(new Date(h.last_human_at).getTime() + HANDOFF_HOURS * HOUR_MS);
}

/**
 * Each alert is a paid WhatsApp template: none while the owner is writing in
 * the chat, and at most one per quarter hour to bring them back.
 */
export function shouldNotify(h: Handoff, now: Date): boolean {
  const quarter = NOTIFY_EVERY_MINUTES * 60_000;
  const ownerAway = now.getTime() - new Date(h.last_human_at).getTime() >= quarter;
  return ownerAway && (!h.notified_at || now.getTime() - new Date(h.notified_at).getTime() >= quarter);
}

/** Meta only lets the business write freely within 24 h of the person's last message. */
export function windowOpen(lastUserAt: string | null, now: Date): boolean {
  return !!lastUserAt && now.getTime() - new Date(lastUserAt).getTime() < WINDOW_HOURS * HOUR_MS;
}

// Self-check: `node core/handoff.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const now = new Date('2026-10-21T18:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  const h = (lastHumanMin: number, notifiedMin: number | null = null): Handoff => ({
    client_id: 'c', contact_id: '521', taken_by: 'u', taken_by_email: 'a@x.mx',
    taken_at: ago(lastHumanMin), last_human_at: ago(lastHumanMin), notified_at: notifiedMin === null ? null : ago(notifiedMin),
  });

  assert.equal(isTaken(null, now), false);
  assert.equal(isTaken(h(10), now), true);
  assert.equal(isTaken(h(239), now), true, 'a los 3 h 59 min sigue tomada');
  assert.equal(isTaken(h(240), now), false, 'a las 4 h exactas vuelve al asistente');
  assert.equal(returnsAt(h(60)).toISOString(), new Date(now.getTime() + 3 * 3600_000).toISOString());

  assert.equal(shouldNotify(h(5), now), false, 'el dueño escribió hace 5 min: está en el chat, no se le avisa');
  assert.equal(shouldNotify(h(20), now), true, 'dueño callado 20 min y nunca avisado: avisa');
  assert.equal(shouldNotify(h(20, 14), now), false, 'avisado hace 14 min: espera');
  assert.equal(shouldNotify(h(20, 15), now), true, 'a los 15 min vuelve a avisar');

  assert.equal(windowOpen(null, now), false, 'sin mensajes de la persona no hay ventana');
  assert.equal(windowOpen(ago(60), now), true);
  assert.equal(windowOpen(ago(24 * 60 - 1), now), true);
  assert.equal(windowOpen(ago(24 * 60), now), false, 'a las 24 h cierra');

  console.log('handoff.ts self-check passed');
}

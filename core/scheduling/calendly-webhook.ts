import assert from 'node:assert';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Calendly's booking webhook.
 *
 * The scheduling API cannot create a booking on someone's behalf — no
 * endpoint in the v2 spec does that. So "the assistant schedules" resolves
 * to three separate pieces, and this file is the third: finding out that a
 * person actually booked, which until now nothing in this repo could know.
 * Interest and a booking are different events, and only one of them is money.
 */

export interface Booking {
  nombre: string;
  email: string;
  /** Name of the Calendly event type, e.g. "Diagnóstico 30 min". */
  evento?: string;
  /** ISO 8601 start of the meeting, straight from Calendly. */
  inicia?: string;
  cancelUrl?: string;
}

/** Calendly signs `${timestamp}.${rawBody}`; stale timestamps are replays. */
const TOLERANCE_MS = 3 * 60 * 1000;

/**
 * Verifies the `Calendly-Webhook-Signature` header, whose shape is
 * `t=1492774577,v1=<hex>`. Must run on the raw bytes before JSON.parse — a
 * re-serialized body won't match byte-for-byte and would always fail.
 */
export function verifyCalendlySignature(
  signingKey: string,
  rawBody: string,
  header: string | null,
  now: Date = new Date(),
): boolean {
  if (!signingKey || !header) return false;

  const parts = new Map(
    header.split(',').map((piece) => {
      const [k, v] = piece.split('=');
      return [k?.trim(), v?.trim()] as [string, string];
    }),
  );

  const t = parts.get('t');
  const v1 = parts.get('v1');
  if (!t || !v1 || !/^\d+$/.test(t)) return false;

  const ageMs = now.getTime() - Number(t) * 1000;
  if (ageMs > TOLERANCE_MS || ageMs < -TOLERANCE_MS) return false;

  const expected = createHmac('sha256', signingKey).update(`${t}.${rawBody}`).digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const givenBuf = Buffer.from(v1, 'hex');
  if (expectedBuf.length !== givenBuf.length) return false;

  return timingSafeEqual(expectedBuf, givenBuf);
}

/**
 * Pulls the parts worth emailing out of an `invitee.created` payload.
 *
 * Deliberately tolerant: every field but name and email is optional, because
 * this shape comes from Calendly's docs and has never been checked against a
 * real delivery. A booking alert missing the start time is still worth far
 * more than a 500.
 *
 * ponytail: shape taken from docs, not from a live event — confirm the field
 * names against the first real booking and tighten if they differ.
 */
export function parseBooking(payload: unknown): Booking | null {
  const body = payload as any;
  if (body?.event !== 'invitee.created') return null;

  const p = body.payload;
  const nombre = p?.name;
  const email = p?.email;
  if (typeof nombre !== 'string' || typeof email !== 'string') return null;

  return {
    nombre,
    email,
    evento: p?.scheduled_event?.name,
    inicia: p?.scheduled_event?.start_time,
    cancelUrl: p?.cancel_url,
  };
}

// Self-check: `node core/scheduling/calendly-webhook.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const key = 'signing-key';
  const body = '{"event":"invitee.created"}';
  const now = new Date('2026-09-28T12:00:00Z');
  const t = Math.floor(now.getTime() / 1000);
  const sign = (ts: number, raw = body, k = key) =>
    `t=${ts},v1=${createHmac('sha256', k).update(`${ts}.${raw}`).digest('hex')}`;

  assert.ok(verifyCalendlySignature(key, body, sign(t), now), 'firma válida debe pasar');
  assert.ok(!verifyCalendlySignature(key, body, sign(t, body, 'otra-llave'), now), 'llave equivocada falla');
  assert.ok(!verifyCalendlySignature(key, body, null, now), 'header ausente falla');
  assert.ok(!verifyCalendlySignature('', body, sign(t), now), 'sin llave configurada falla');
  assert.ok(!verifyCalendlySignature(key, '{"otro":1}', sign(t), now), 'cuerpo alterado falla');
  assert.ok(!verifyCalendlySignature(key, body, `t=${t},v1=abc`, now), 'firma corta falla sin reventar');
  assert.ok(!verifyCalendlySignature(key, body, `v1=${'0'.repeat(64)}`, now), 'sin timestamp falla');

  // Replay: la firma es correcta, el timestamp no.
  assert.ok(!verifyCalendlySignature(key, body, sign(t - 4 * 60), now), 'timestamp viejo falla');
  assert.ok(!verifyCalendlySignature(key, body, sign(t + 4 * 60), now), 'timestamp del futuro falla');
  assert.ok(verifyCalendlySignature(key, body, sign(t - 60), now), 'un minuto de antigüedad pasa');

  const booked = parseBooking({
    event: 'invitee.created',
    payload: {
      name: 'Juan Pérez',
      email: 'juan@ejemplo.mx',
      cancel_url: 'https://calendly.com/cancellations/abc',
      scheduled_event: { name: 'Diagnóstico 30 min', start_time: '2026-10-01T17:00:00.000000Z' },
    },
  });
  assert.equal(booked?.nombre, 'Juan Pérez');
  assert.equal(booked?.evento, 'Diagnóstico 30 min');
  assert.equal(booked?.inicia, '2026-10-01T17:00:00.000000Z');

  // Un evento a medias sigue valiendo un correo.
  const parcial = parseBooking({ event: 'invitee.created', payload: { name: 'Ana', email: 'a@b.mx' } });
  assert.equal(parcial?.nombre, 'Ana');
  assert.equal(parcial?.inicia, undefined);

  assert.equal(parseBooking({ event: 'invitee.canceled', payload: { name: 'A', email: 'a@b.mx' } }), null);
  assert.equal(parseBooking({ event: 'invitee.created', payload: { name: 'A' } }), null, 'sin correo no es lead');
  assert.equal(parseBooking(null), null);

  console.log('calendly-webhook.ts self-check passed');
}

import assert from 'node:assert';
import type { Scheduler, SlotPick } from './types.ts';
import { describeSlot, spreadAcrossDays, withinHours } from './calendly.ts';

export interface CalcomOptions {
  /** API key (`cal_…`). Without it the scheduler only hands over the link. */
  apiKey?: string;
  eventTypeId?: number;
  /** See CalendlyOptions: every time is anchored to the business's zone. */
  timeZone?: string;
  locale?: string;
  earliestHour?: number;
  latestHour?: number;
}

const API = 'https://api.cal.com/v2';
const DAYS_SHOWN = 7;
// A person may pick a day after the ones shown ("¿y el lunes siguiente?").
const DAYS_BOOKABLE = 14;
// A slow calendar falls back to the link instead of holding the reply.
const TIMEOUT_MS = 8_000;

/**
 * Unlike Calendly, Cal.com's API can create the booking itself, so the
 * meeting gets made inside the conversation instead of behind a link.
 */
export function createCalcomScheduler(url: string, opts: CalcomOptions = {}): Scheduler {
  const { apiKey, eventTypeId, timeZone = 'UTC', locale = 'es-MX', earliestHour, latestHour } = opts;

  const scheduler: Scheduler = { provider: 'calcom', bookingUrl: () => url };
  if (!apiKey || !eventTypeId) return scheduler;

  async function openSlots(days: number): Promise<string[]> {
    const start = new Date(Date.now() + 5 * 60 * 1000);
    const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
    const query = new URLSearchParams({
      eventTypeId: String(eventTypeId),
      start: start.toISOString(),
      end: end.toISOString(),
    });

    const res = await fetch(`${API}/slots?${query}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'cal-api-version': '2024-09-04' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Cal.com slots failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { data?: Record<string, { start?: string }[]> };
    const times = Object.values(body.data ?? {})
      .flat()
      .map((slot) => slot.start)
      .filter((t): t is string => typeof t === 'string')
      .map((t) => new Date(t).toISOString())
      .sort();

    return withinHours(times, timeZone, earliestHour, latestHour);
  }

  scheduler.availability = async () =>
    spreadAcrossDays(await openSlots(DAYS_SHOWN), timeZone).map((iso) => describeSlot(iso, locale, timeZone));

  scheduler.book = async (when, attendee) => {
    // Cal.com refuses an attendee it has no way to reach.
    if (!attendee.email && !attendee.telefono) {
      return { booked: false, reason: 'needs_contact', missing: 'teléfono o correo' };
    }
    // Fetched again on purpose: the slot may have been taken since it was offered.
    const start = (await openSlots(DAYS_BOOKABLE)).find((iso) => isSlot(iso, when, timeZone));
    if (!start) return { booked: false, reason: 'taken' };

    const res = await fetch(`${API}/bookings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'cal-api-version': '2026-02-25',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        start,
        eventTypeId,
        attendee: {
          name: attendee.nombre,
          timeZone,
          language: locale.slice(0, 2),
          ...(attendee.email ? { email: attendee.email } : {}),
          ...(attendee.telefono ? { phoneNumber: attendee.telefono } : {}),
        },
        ...(attendee.notas ? { bookingFieldsResponses: { notes: attendee.notas } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text();
      // Which contact is mandatory is a setting of the event type, so the
      // calendar is the one that knows; its complaint names the field.
      const missing = missingField(body);
      if (res.status === 400 && missing) return { booked: false, reason: 'needs_contact', missing };
      throw new Error(`Cal.com booking failed: ${res.status} ${body}`);
    }

    return { booked: true, start, label: describeSlot(start, locale, timeZone) };
  };

  scheduler.bookedPhones = async (since) => {
    // ponytail: one page of the 100 newest; a calendar with more bookings than
    // that in the follow-up window (~3 days) needs pagination.
    const query = new URLSearchParams({ sortCreated: 'desc', take: '100' });
    const res = await fetch(`${API}/bookings?${query}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'cal-api-version': '2024-08-13' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Cal.com bookings failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data?: CalcomBooking[] };
    return phonesFromBookings(body.data ?? [], since);
  };

  return scheduler;
}

export function missingField(errorBody: string): string | null {
  if (!/required/i.test(errorBody)) return null;
  if (/attendeePhoneNumber|phone/i.test(errorBody)) return 'teléfono';
  if (/email/i.test(errorBody)) return 'correo';
  return null;
}

/** Whether a UTC slot falls on the business-local month, day and time picked. */
export function isSlot(iso: string, when: SlotPick, timeZone: string): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  const [hour, minute] = when.time.split(':').map(Number);
  return (
    Number(parts.month) === when.month &&
    Number(parts.day) === when.day &&
    Number(parts.hour) === hour &&
    Number(parts.minute) === (minute || 0)
  );
}

export interface CalcomBooking {
  status?: string;
  createdAt?: string;
  attendees?: { phoneNumber?: string | null }[];
}

/** Someone who cancelled is left out on purpose: the nudge is still useful to them. */
export function phonesFromBookings(bookings: CalcomBooking[], since: Date): string[] {
  return bookings
    .filter((b) => b.status !== 'cancelled' && b.createdAt && new Date(b.createdAt) >= since)
    .flatMap((b) => b.attendees ?? [])
    .map((a) => a.phoneNumber)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
}

// Self-check: `node core/scheduling/calcom.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const TZ = 'America/Mexico_City';

  // 15:00Z is 9:00 in Mexico City (UTC-6, no DST since 2022).
  assert.ok(isSlot('2026-10-12T15:00:00.000Z', { month: 10, day: 12, time: '09:00' }, TZ));
  assert.ok(isSlot('2026-10-12T15:00:00.000Z', { month: 10, day: 12, time: '9:00' }, TZ), 'acepta la hora sin cero');
  assert.ok(!isSlot('2026-10-12T15:00:00.000Z', { month: 10, day: 12, time: '15:00' }, TZ), 'la hora es la del negocio, no UTC');
  assert.ok(!isSlot('2026-10-12T15:30:00.000Z', { month: 10, day: 12, time: '09:00' }, TZ), 'los minutos cuentan');
  // 03:00Z del 13 sigue siendo la noche del 12 en México.
  assert.ok(isSlot('2026-10-13T03:00:00.000Z', { month: 10, day: 12, time: '21:00' }, TZ), 'el día es el local');

  assert.equal(missingField('{"error":{"message":"responses - {email}error_required_field, "}}'), 'correo');
  assert.equal(missingField('{"message":"responses - {attendeePhoneNumber}error_required_field, "}'), 'teléfono');
  assert.equal(missingField('{"message":"slot not available"}'), null, 'otro 400 no se confunde con un dato faltante');

  const since = new Date('2026-10-10T00:00:00Z');
  assert.deepEqual(
    phonesFromBookings(
      [
        { status: 'accepted', createdAt: '2026-10-11T20:00:00Z', attendees: [{ phoneNumber: '+5212225344440' }] },
        { status: 'cancelled', createdAt: '2026-10-11T21:00:00Z', attendees: [{ phoneNumber: '+522225550101' }] },
        { status: 'accepted', createdAt: '2026-10-01T10:00:00Z', attendees: [{ phoneNumber: '+522225559999' }] },
        { status: 'accepted', createdAt: '2026-10-12T10:00:00Z', attendees: [{ phoneNumber: null }, {}] },
      ],
      since,
    ),
    ['+5212225344440'],
    'solo citas vigentes creadas desde `since`, y solo las que traen teléfono',
  );

  console.log('calcom.ts self-check passed');
}

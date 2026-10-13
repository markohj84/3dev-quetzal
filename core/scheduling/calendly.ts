import assert from 'node:assert';
import type { Scheduler } from './types.ts';

export interface CalendlyOptions {
  /** Personal access token. Without it the scheduler only hands over the link. */
  token?: string;
  /** URI of the event type to read availability from. */
  eventTypeUri?: string;
  /**
   * Timezone the times are spoken in. Whoever is reading has their own, and
   * the assistant has no way to learn it, so every time is anchored to the
   * business's and said out loud — an unqualified "10:00" is a missed meeting.
   */
  timeZone?: string;
  locale?: string;
  /**
   * Floor and ceiling, in the business's own hours, for what the assistant is
   * willing to say out loud. A calendar whose timezone is misconfigured
   * offers perfectly real slots at hours nobody wants, and the assistant has
   * no way to notice — this is the knob that keeps a settings mistake from
   * reaching a prospect. Both undefined means propose whatever is open.
   */
  earliestHour?: number;
  latestHour?: number;
}

const DAYS_AHEAD = 7;
const MAX_SLOTS = 5;
const MAX_PER_DAY = 2;
// Second slot of a day: at least this long after the first, when there is one.
const MIN_GAP_MS = 3 * 60 * 60 * 1000;

export function createCalendlyScheduler(url: string, opts: CalendlyOptions = {}): Scheduler {
  const { token, eventTypeUri, timeZone = 'UTC', locale = 'es-MX', earliestHour, latestHour } = opts;

  const scheduler: Scheduler = { provider: 'calendly', bookingUrl: () => url };

  if (!token || !eventTypeUri) return scheduler;

  scheduler.availability = async () => {
    const start = new Date(Date.now() + 5 * 60 * 1000);
    const end = new Date(start.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);

    const query = new URLSearchParams({
      event_type: eventTypeUri,
      start_time: start.toISOString().replace(/\.\d+Z$/, 'Z'),
      end_time: end.toISOString().replace(/\.\d+Z$/, 'Z'),
    });

    const res = await fetch(`https://api.calendly.com/event_type_available_times?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      throw new Error(`Calendly availability failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { collection?: { start_time?: string }[] };
    const times = (body.collection ?? [])
      .map((slot) => slot.start_time)
      .filter((t): t is string => typeof t === 'string');

    const decent = withinHours(times, timeZone, earliestHour, latestHour);
    return spreadAcrossDays(decent, timeZone).map((iso) => describeSlot(iso, locale, timeZone));
  };

  return scheduler;
}

/** Drops slots outside the hours the business is willing to be seen offering. */
export function withinHours(
  times: string[],
  timeZone: string,
  from?: number,
  to?: number,
): string[] {
  if (from === undefined && to === undefined) return times;

  return times.filter((iso) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .find((p) => p.type === 'hour');
    const hour = Number(parts?.value) % 24;

    if (Number.isNaN(hour)) return false;
    return (from === undefined || hour >= from) && (to === undefined || hour < to);
  });
}

/**
 * Calendars return every open slot in order, so the first five are usually
 * the same morning. Offering one Tuesday and one Thursday is worth more to
 * the person reading than five consecutive half hours — and within a day, a
 * morning and an afternoon beat 9:00 and 9:30.
 */
export function spreadAcrossDays(times: string[], timeZone: string): string[] {
  const byDay = new Map<string, string[]>();
  for (const iso of times) {
    const day = new Date(iso).toLocaleDateString('en-CA', { timeZone });
    byDay.set(day, [...(byDay.get(day) ?? []), iso]);
  }

  const picked: string[] = [];
  for (const slots of byDay.values()) {
    const first = slots[0];
    const later = slots.find((t) => Date.parse(t) - Date.parse(first) >= MIN_GAP_MS) ?? slots[1];
    picked.push(...[first, later].filter(Boolean).slice(0, MAX_PER_DAY));
    if (picked.length >= MAX_SLOTS) break;
  }

  return picked.slice(0, MAX_SLOTS);
}

/** "miércoles, 30 de septiembre, 8:00 a.m." — never a bare time. */
export function describeSlot(iso: string, locale: string, timeZone: string): string {
  return new Date(iso).toLocaleString(locale, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Self-check: `node core/scheduling/calendly.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const TZ = 'America/Mexico_City';

  // Nine consecutive half hours across two days, as Calendly actually returns them.
  const times = [
    '2026-09-30T14:00:00Z', '2026-09-30T14:30:00Z', '2026-09-30T15:00:00Z',
    '2026-09-30T15:30:00Z', '2026-09-30T16:00:00Z',
    '2026-10-01T14:00:00Z', '2026-10-01T14:30:00Z',
    '2026-10-02T14:00:00Z', '2026-10-02T14:30:00Z',
  ];

  const picked = spreadAcrossDays(times, TZ);
  assert.equal(picked.length, 5, 'tope de cinco horarios');
  assert.deepEqual(
    picked,
    ['2026-09-30T14:00:00Z', '2026-09-30T14:30:00Z', '2026-10-01T14:00:00Z', '2026-10-01T14:30:00Z', '2026-10-02T14:00:00Z'],
    'máximo dos por día, en orden',
  );
  assert.equal(new Set(picked.map((t) => t.slice(0, 10))).size, 3, 'debe abarcar tres días distintos');

  assert.deepEqual(spreadAcrossDays([], TZ), [], 'sin horarios no truena');

  // Un día lleno de 9:00 a 17:00: mañana y tarde, no 9:00 y 9:30.
  const diaLleno = Array.from({ length: 16 }, (_, i) => new Date(Date.parse('2026-10-12T15:00:00Z') + i * 30 * 60_000).toISOString());
  assert.deepEqual(
    spreadAcrossDays(diaLleno, TZ),
    ['2026-10-12T15:00:00.000Z', '2026-10-12T18:00:00.000Z'],
    '9:00 y 12:00, la primera al menos tres horas después',
  );

  // El corte de día es el de la zona horaria del negocio, no el de UTC:
  // 03:00Z del día 1 sigue siendo la noche del 30 en México.
  const cruzaMedianoche = ['2026-10-01T03:00:00Z', '2026-10-01T04:00:00Z', '2026-10-01T05:00:00Z'];
  assert.equal(spreadAcrossDays(cruzaMedianoche, TZ).length, 2, 'agrupa por el día local del negocio');

  // 13:00Z = 7:00 en México: real, reservable, y nadie la quiere.
  const madrugadores = ['2026-09-30T13:00:00Z', '2026-09-30T15:00:00Z', '2026-09-30T23:00:00Z'];
  assert.deepEqual(
    withinHours(madrugadores, TZ, 9, 18),
    ['2026-09-30T15:00:00Z', '2026-09-30T23:00:00Z'],
    'cae la de las 7:00; pasan la de 9:00 y la de 17:00',
  );
  assert.equal(withinHours(madrugadores, TZ).length, 3, 'sin límites no filtra nada');
  assert.deepEqual(withinHours(['2026-09-30T06:00:00Z'], TZ, 9, 18), [], 'medianoche local queda fuera');

  const dicho = describeSlot('2026-09-30T14:00:00Z', 'es-MX', TZ);
  assert.match(dicho, /miércoles/, 'debe nombrar el día');
  assert.match(dicho, /septiembre/, 'debe nombrar el mes');
  assert.match(dicho, /8:00/, '14:00Z son las 8:00 en el centro de México');

  // Sin token no hay promesa de disponibilidad que el motor pueda creer.
  assert.equal(createCalendlyScheduler('https://calendly.com/x').availability, undefined);
  assert.equal(
    typeof createCalendlyScheduler('https://calendly.com/x', { token: 't', eventTypeUri: 'e' }).availability,
    'function',
  );

  console.log('calendly.ts self-check passed');
}

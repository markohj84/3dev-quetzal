/**
 * Scheduling is an interface so a client can swap Calendly for HubSpot,
 * Cal.com, or a plain mailto without touching the engine.
 */
export interface Scheduler {
  readonly provider: string;
  /** A link the prospect can open to pick a time. */
  bookingUrl(): string;
  /**
   * Real open times, already worded for the person reading them. Optional:
   * a provider that cannot report availability simply omits it, and the
   * engine falls back to handing over the link.
   */
  availability?(): Promise<string[]>;
  /**
   * Books a meeting at a time the person picked from the ones offered.
   * Takes the business-local day and time the assistant said out loud, not
   * an ISO string: the slots offered last turn are gone by now, and asking
   * the model to rebuild a UTC timestamp is how a meeting lands an hour off.
   * Optional: a provider whose API cannot book (Calendly) omits it.
   */
  book?(when: SlotPick, attendee: Attendee): Promise<BookingOutcome>;
}

export interface SlotPick {
  month: number;
  day: number;
  /** "HH:MM", 24h, in the business's timezone. */
  time: string;
}

export interface Attendee {
  nombre: string;
  email?: string;
  /** International format, e.g. +522221234567. */
  telefono?: string;
  /** Free text for whoever takes the meeting: what they need, how to reach them. */
  notas?: string;
}

export type BookingOutcome =
  | { booked: true; start: string; label: string }
  | { booked: false; reason: 'taken' }
  /** The calendar insists on a way to reach them; `missing` says which, in words. */
  | { booked: false; reason: 'needs_contact'; missing: string };

export function createNullScheduler(): Scheduler {
  return { provider: 'none', bookingUrl: () => '' };
}

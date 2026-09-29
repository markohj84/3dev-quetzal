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
}

export function createNullScheduler(): Scheduler {
  return { provider: 'none', bookingUrl: () => '' };
}

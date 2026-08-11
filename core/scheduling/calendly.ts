import type { Scheduler } from './types';

export function createCalendlyScheduler(url: string): Scheduler {
  return { provider: 'calendly', bookingUrl: () => url };
}

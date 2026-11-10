import { after } from 'next/server';
import { createFailureNotifier, type LeadAlert } from '../core/notify';
import { createRateLimiter } from '../core/store/session-store';
import type { Assistant } from './assistant';

// An outage fails every message, and one alert per client and hour says it all.
const ration = createRateLimiter(1, 60 * 60);

/**
 * Tells whoever operates the assistant that it could not answer. ALERT_EMAIL
 * is the platform's operator; without it the alert goes out on the client's
 * own channels (see createFailureNotifier).
 */
export async function reportFailure(
  { config, secrets }: Pick<Assistant, 'config' | 'secrets'>,
  alert: Omit<LeadAlert, 'failure'>,
  text: string,
  error: unknown,
): Promise<void> {
  // A limiter that cannot be read must not silence the alert.
  const first = await ration.check(`failed:${config.id}`).catch(() => true);
  if (!first) return;
  const failure = { text, error: String((error as Error)?.message ?? error).slice(0, 300) };
  after(() => createFailureNotifier(config.notify, secrets, process.env.ALERT_EMAIL).notify({ ...alert, failure }));
}

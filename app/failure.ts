import { after } from 'next/server';
import { createFailureNotifier, type LeadAlert } from '../core/notify';
import { createRateLimiter } from '../core/store/session-store';
import type { Assistant } from './assistant';

// An outage fails every message, and one alert per client, kind and hour says it all.
const ration = createRateLimiter(1, 60 * 60);
// A dev server shares production's Redis, and every WhatsApp eval ends in a send Meta
// turns down: its alerts are rationed apart, or each run would silence production's for the hour.
const where = process.env.VERCEL_ENV ?? 'local';

/**
 * Tells whoever operates the assistant that a reply did not reach the person.
 * With `text`, that message went unanswered: the model failed, or Meta turned
 * the reply down. Without it, Meta reported later that a message it had
 * accepted never arrived. ALERT_EMAIL is the platform's operator; without it
 * the alert goes out on the client's own channels (see createFailureNotifier).
 */
export async function reportFailure(
  { config, secrets }: Pick<Assistant, 'config' | 'secrets'>,
  alert: Omit<LeadAlert, 'failure'>,
  text: string | undefined,
  error: unknown,
): Promise<void> {
  // A dead model and an unpaid Meta account are different fixes: one must not silence the other.
  const kind = text === undefined ? 'delivery' : 'answer';
  // A limiter that cannot be read must not silence the alert.
  const first = await ration.check(`failed:${where}:${kind}:${config.id}`).catch(() => true);
  if (!first) return;
  const failure = { text, error: String((error as Error)?.message ?? error).slice(0, 300) };
  after(() => createFailureNotifier(config.notify, secrets, process.env.ALERT_EMAIL).notify({ ...alert, failure }));
}

import { after } from 'next/server';
import { getAssistantOrNull } from '../../assistant';
import { verifyCalendlySignature, parseBooking } from '../../../core/scheduling/calendly-webhook';
import { createLeadNotifier } from '../../../core/notify';

/**
 * Calendly calls this when someone actually books. Until now the only signal
 * was interest — this is the one that says a meeting exists.
 *
 * Inert until CALENDLY_WEBHOOK_SIGNING_KEY is set and the subscription is
 * registered: with no key every request is rejected, which is the safe way
 * round.
 */
export async function POST(request: Request) {
  const assistant = await getAssistantOrNull();
  if (!assistant) return new Response('not found', { status: 404 });
  const { config, secrets } = assistant;
  const rawBody = await request.text();

  if (
    !verifyCalendlySignature(
      secrets.calendlySigningKey ?? '',
      rawBody,
      request.headers.get('calendly-webhook-signature'),
    )
  ) {
    return new Response('forbidden', { status: 403 });
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    /* parseBooking(null) returns null below, same as any unusable body */
  }

  const booking = parseBooking(parsed);
  // Calendly retries non-2xx, including the event types we don't act on.
  if (!booking) return new Response('ok', { status: 200 });

  try {
    after(() => createLeadNotifier(config.notify, secrets).notify({
      channel: 'calendly',
      contactId: booking.email,
      transcript: [],
      booking,
    }));
  } catch (error) {
    console.error(`[${config.id}] calendly webhook failed`, error);
  }

  return new Response('ok', { status: 200 });
}

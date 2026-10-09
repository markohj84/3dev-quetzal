import { getAssistant } from '../../assistant';
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
  const rawBody = await request.text();

  if (
    !verifyCalendlySignature(
      process.env.CALENDLY_WEBHOOK_SIGNING_KEY ?? '',
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

  const { config } = await getAssistant();

  try {
    await createLeadNotifier(config.notify).notify({
      channel: 'calendly',
      contactId: booking.email,
      transcript: [],
      booking,
    });
  } catch (error) {
    console.error(`[${config.id}] calendly webhook failed`, error);
  }

  return new Response('ok', { status: 200 });
}

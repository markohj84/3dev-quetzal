import { NextResponse } from 'next/server';
import { getAssistant } from '../../assistant';
import { createWhatsAppAdapter, verifySignature } from '../../../core/channels/whatsapp';
import {
  createSessionStore,
  createInboundClock,
  createRateLimiter,
  createConversationLog,
  createLeadStore,
} from '../../../core/store/session-store';
import { createLeadNotifier } from '../../../core/notify';

const sessions = createSessionStore();
const inboundClock = createInboundClock();
// contactId here is Meta's own phone number id, not caller-supplied — safe to key on directly.
const rateLimiter = createRateLimiter(20, 60);

const adapter = createWhatsAppAdapter({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
  lastInboundAt: (id) => inboundClock.get(id),
});

/** Meta verifies the webhook with a GET before it will send anything. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(params.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

export async function POST(request: Request) {
  const { engine, config } = await getAssistant();

  if (!config.channels.whatsapp.enabled) {
    return NextResponse.json({ error: 'channel disabled' }, { status: 404 });
  }

  const rawBody = await request.text();
  if (!verifySignature(process.env.WHATSAPP_APP_SECRET ?? '', rawBody, request.headers.get('x-hub-signature-256'))) {
    return new Response('forbidden', { status: 403 });
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    /* falls through to adapter.parse(null) below, same as a malformed body always has */
  }
  const inbound = adapter.parse(parsed);
  // Meta retries anything that is not a 200, including delivery receipts.
  if (!inbound) return new Response('ok', { status: 200 });

  if (!(await rateLimiter.check(inbound.contactId))) {
    return new Response('ok', { status: 200 });
  }

  await inboundClock.set(inbound.contactId, inbound.receivedAt);
  const state = (await sessions.get(inbound.contactId)) ?? { history: [], hasOffered: false };

  try {
    const result = await engine.respond(state, inbound.text, adapter);
    await sessions.set(inbound.contactId, result.state);
    await adapter.deliver(inbound.contactId, result.reply);
    await createConversationLog(config.id).append({
      channel: 'whatsapp',
      contactId: inbound.contactId,
      userText: inbound.text,
      assistantText: result.reply.text,
      at: new Date(),
    });

    if (!state.hasOffered && result.state.hasOffered) {
      await createLeadNotifier(config.notify.email, config.notify.fromEmail).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: result.state.history,
      });
    }

    if (result.capturedLead) {
      await createLeadStore(config.id).save({
        ...result.capturedLead,
        channel: 'whatsapp',
        contactId: inbound.contactId,
        at: new Date().toISOString(),
      });
      await createLeadNotifier(config.notify.email, config.notify.fromEmail).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: result.state.history,
        captured: result.capturedLead,
      });
    }
  } catch (error) {
    console.error(`[${config.id}] whatsapp failed`, error);
  }

  return new Response('ok', { status: 200 });
}

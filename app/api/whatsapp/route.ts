import { NextResponse } from 'next/server';
import { getAssistant } from '../../assistant';
import { createWhatsAppAdapter, toMetaRecipient, verifySignature } from '../../../core/channels/whatsapp';
import {
  createSessionStore,
  createRateLimiter,
  createConversationLog,
  createLeadStore,
  createProfileStore,
} from '../../../core/store/session-store';
import { createLeadNotifier } from '../../../core/notify';

const sessions = createSessionStore();
// contactId here is Meta's own phone number id, not caller-supplied — safe to key on directly.
const rateLimiter = createRateLimiter(20, 60);

const adapter = createWhatsAppAdapter({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
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

  const state = (await sessions.get(inbound.contactId)) ?? { history: [], hasOffered: false };
  const profiles = createProfileStore(config.id);

  try {
    const profile = await profiles.get(inbound.contactId);
    const result = await engine.respond(state, inbound.text, adapter, {
      ...profile,
      displayName: inbound.displayName,
    });
    await sessions.set(inbound.contactId, result.state);
    // A failed send (expired token, billing, Meta outage) must not also lose
    // the log, the lead and the alert: what the person said still happened.
    await adapter.deliver(inbound.contactId, result.reply).catch((error) => {
      console.error(`[${config.id}] whatsapp delivery failed`, error);
    });
    const reachAt = `https://wa.me/${toMetaRecipient(inbound.contactId)}`;
    await createConversationLog(config.id).append({
      channel: 'whatsapp',
      contactId: inbound.contactId,
      userText: inbound.text,
      assistantText: result.reply.text,
      at: new Date(),
    });

    // Only someone we learned something about gets a profile; after that,
    // every message keeps it alive for another 90 days.
    const { remembered, capturedLead } = result;
    if (profile || remembered || capturedLead) {
      await profiles.set(inbound.contactId, {
        name: remembered?.nombre || capturedLead?.nombre || profile?.name,
        interest: remembered?.interes || capturedLead?.necesidad || profile?.interest,
        leftContact: profile?.leftContact || !!capturedLead,
        lastSeenAt: new Date().toISOString(),
      });
    }

    if (!state.hasOffered && result.state.hasOffered) {
      await createLeadNotifier(config.notify.email, config.notify.fromEmail).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: result.state.history,
        reachAt,
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
        reachAt,
      });
    }
  } catch (error) {
    console.error(`[${config.id}] whatsapp failed`, error);
  }

  return new Response('ok', { status: 200 });
}

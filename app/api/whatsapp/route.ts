import { NextResponse } from 'next/server';
import { getAssistant } from '../../assistant';
import { createWhatsAppAdapter, toMetaRecipient, verifySignature } from '../../../core/channels/whatsapp';
import { createSessionStore, createRateLimiter } from '../../../core/store/session-store';
import { createConversationLog, createLeadStore, createFollowUpStore, createProfileStore, createHandoffStore } from '../../../core/store/db';
import { isTaken, shouldNotify } from '../../../core/handoff';
import { panelUrl } from '../../panel/links';
import { createLeadNotifier } from '../../../core/notify';
import { leadPhone } from '../../../core/followup';

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

  // The owner has this conversation: the person is heard, not answered.
  const handoffs = createHandoffStore(config.id);
  const handoff = await handoffs.get(inbound.contactId).catch((error) => {
    // An extra reply beats a person left unanswered.
    console.error(`[${config.id}] handoff lookup failed`, error);
    return null;
  });
  const now = new Date();
  if (handoff && isTaken(handoff, now)) {
    await createConversationLog(config.id)
      .appendInbound({ channel: 'whatsapp', contactId: inbound.contactId, userText: inbound.text, at: now })
      .catch((error) => console.error(`[${config.id}] conversation log failed`, error));
    // In the session too, so the assistant has the whole thread when it takes over again.
    await sessions.set(inbound.contactId, { ...state, history: [...state.history, { role: 'user', content: inbound.text }] });
    if (shouldNotify(handoff, now)) {
      const profile = await profiles.get(inbound.contactId).catch(() => null);
      await createLeadNotifier(config.notify).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: [],
        reachAt: `https://wa.me/${toMetaRecipient(inbound.contactId)}`,
        panelUrl: panelUrl(inbound.contactId),
        inbound: { name: profile?.name ?? `+${toMetaRecipient(inbound.contactId)}`, text: inbound.text },
      });
      await handoffs.markNotified(inbound.contactId).catch((error) => console.error(`[${config.id}] handoff notify mark failed`, error));
    }
    return new Response('ok', { status: 200 });
  }
  if (handoff) {
    await handoffs.release(inbound.contactId).catch((error) => console.error(`[${config.id}] handoff release failed`, error));
  }

  try {
    // No profile is a fine way to start a conversation; no reply is not.
    const profile = await profiles.get(inbound.contactId).catch((error) => {
      console.error(`[${config.id}] profile load failed`, error);
      return null;
    });
    const result = await engine.respond(state, inbound.text, adapter, {
      ...profile,
      displayName: inbound.displayName,
      phone: `+${toMetaRecipient(inbound.contactId)}`,
    });
    await sessions.set(inbound.contactId, result.state);
    // A failed send (expired token, billing, Meta outage) must not also lose
    // the log, the lead and the alert: what the person said still happened.
    await adapter.deliver(inbound.contactId, result.reply).catch((error) => {
      console.error(`[${config.id}] whatsapp delivery failed`, error);
    });
    const reachAt = `https://wa.me/${toMetaRecipient(inbound.contactId)}`;
    // The log is a record, not the reply: a database hiccup must not cost the person their answer.
    await createConversationLog(config.id)
      .append({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        userText: inbound.text,
        assistantText: result.reply.text,
        at: new Date(),
      })
      .catch((error) => console.error(`[${config.id}] conversation log failed`, error));

    // Only someone we learned something about gets a profile; after that,
    // every message keeps it alive for another 90 days.
    const { remembered, capturedLead } = result;
    if (profile || remembered || capturedLead) {
      await profiles.set(
        inbound.contactId,
        {
          name: remembered?.nombre || capturedLead?.nombre || profile?.name,
          interest: remembered?.interes || capturedLead?.necesidad || profile?.interest,
          leftContact: profile?.leftContact || !!capturedLead,
          lastSeenAt: new Date().toISOString(),
        },
        'whatsapp',
      ).catch((error) => console.error(`[${config.id}] profile save failed`, error));
    }

    if (!state.hasOffered && result.state.hasOffered) {
      await createLeadNotifier(config.notify).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: result.state.history,
        reachAt,
        panelUrl: panelUrl(inbound.contactId),
      });
    }

    if (result.capturedLead) {
      // The alert below carries the same data: a failed save must not also lose it.
      await createLeadStore(config.id)
        .save({
          ...result.capturedLead,
          channel: 'whatsapp',
          contactId: inbound.contactId,
          at: new Date().toISOString(),
        })
        .catch((error) => console.error(`[${config.id}] lead save failed`, error));
      await createLeadNotifier(config.notify).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: result.state.history,
        captured: result.capturedLead,
        reachAt,
        panelUrl: panelUrl(inbound.contactId),
      });
    }

    if (result.booked) {
      // Booked people need no follow-up nudge.
      const phone = leadPhone(
        { nombre: '', contacto: result.booked.telefono ?? '', channel: 'whatsapp', contactId: inbound.contactId, at: '' },
        config.followUp?.countryCode,
      );
      // The meeting exists either way; worst case is one extra nudge, never a lost alert.
      if (phone) {
        await createFollowUpStore(config.id)
          .mark(phone, 'booked')
          .catch((error) => console.error(`[${config.id}] follow-up mark failed`, error));
      }
      await createLeadNotifier(config.notify).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: result.state.history,
        booking: result.booked,
        reachAt,
        panelUrl: panelUrl(inbound.contactId),
      });
    }
  } catch (error) {
    console.error(`[${config.id}] whatsapp failed`, error);
  }

  return new Response('ok', { status: 200 });
}

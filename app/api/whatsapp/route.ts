import { NextResponse, after } from 'next/server';
import { assistantFor, getAssistantOrNull, tenantByPhoneNumberId } from '../../assistant';
import { createWhatsAppAdapter, toMetaRecipient, verifySignature } from '../../../core/channels/whatsapp';
import { createSessionStore, createRateLimiter } from '../../../core/store/session-store';
import { createConversationLog, createLeadStore, createFollowUpStore, createProfileStore, createHandoffStore, createUsageLog } from '../../../core/store/db';
import { isTaken, shouldNotify } from '../../../core/handoff';
import { withStart } from '../../../core/engine/prompt';
import { panelUrl } from '../../panel/links';
import { createLeadNotifier } from '../../../core/notify';
import { leadPhone } from '../../../core/followup';

// contactId here is Meta's own phone number id, not caller-supplied — safe to key on directly.
const rateLimiter = createRateLimiter(20, 60);

/** Meta verifies the webhook with a GET before it will send anything. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // The Meta app is the platform's: the token is shared unless this host's client brought its own.
  const assistant = await getAssistantOrNull();
  const token = assistant?.secrets.whatsappVerifyToken ?? process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && params.get('hub.verify_token') === token) {
    return new Response(params.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    /* falls through to adapter.parse(null) below, same as a malformed body always has */
  }

  // One Meta app, one webhook, many numbers: the number the message arrived at
  // says whose it is. Read before the signature only to pick WHICH secret
  // checks it; nothing is processed until that check passes.
  const toNumber = (parsed as any)?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id as string | undefined;
  const tenant = await tenantByPhoneNumberId(toNumber);
  if (!tenant) {
    // Meta retries anything that is not a 200; a number nobody here owns is not ours to answer.
    console.warn(`[whatsapp] ignorado: el número ${toNumber} no es de ningún cliente de este despliegue`);
    return new Response('ok', { status: 200 });
  }
  const { engine, config, secrets } = await assistantFor(tenant);

  if (!config.channels.whatsapp.enabled) {
    return NextResponse.json({ error: 'channel disabled' }, { status: 404 });
  }

  if (!verifySignature(secrets.whatsappAppSecret ?? '', rawBody, request.headers.get('x-hub-signature-256'))) {
    return new Response('forbidden', { status: 403 });
  }

  const sessions = createSessionStore(config.id);
  const adapter = createWhatsAppAdapter({
    phoneNumberId: secrets.whatsapp.phoneNumberId ?? '',
    accessToken: secrets.whatsapp.token ?? '',
  });
  const inbound = adapter.parse(parsed);
  // Meta retries anything that is not a 200, including delivery receipts.
  if (!inbound) return new Response('ok', { status: 200 });

  if (!(await rateLimiter.check(`${config.id}:${inbound.contactId}`))) {
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
    // A Redis error must still answer 200: Meta's retries would duplicate the row and the alert.
    await sessions
      // withStart: a session born here must still mark its start, or this thread comes back as "earlier".
      .set(inbound.contactId, { ...withStart(state, now), history: [...state.history, { role: 'user', content: inbound.text }] })
      .catch((error) => console.error(`[${config.id}] session append failed`, error));
    if (shouldNotify(handoff, now)) {
      const profile = await profiles.get(inbound.contactId).catch(() => null);
      after(() => createLeadNotifier(config.notify, secrets).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: [],
        reachAt: `https://wa.me/${toMetaRecipient(inbound.contactId)}`,
        panelUrl: panelUrl(config, inbound.contactId),
        inbound: { name: profile?.name ?? `+${toMetaRecipient(inbound.contactId)}`, text: inbound.text },
      }));
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
    // Memory: what this person said before this conversation began (the session's startedAt).
    const earlier = await createConversationLog(config.id)
      .earlier(inbound.contactId, state.startedAt ? new Date(state.startedAt) : new Date())
      .catch((error) => {
        console.error(`[${config.id}] memory lookup failed`, error);
        return [];
      });
    const result = await engine.respond(state, inbound.text, adapter, {
      ...profile,
      displayName: inbound.displayName,
      phone: `+${toMetaRecipient(inbound.contactId)}`,
      earlier,
    });
    await sessions.set(inbound.contactId, result.state);
    // Tokens are bookkeeping, not the reply: a database hiccup costs a log line.
    await createUsageLog(config.id)
      .record(inbound.contactId, result.usage)
      .catch((error) => console.error(`[${config.id}] usage log failed`, error));
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
      after(() => createLeadNotifier(config.notify, secrets).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: result.state.history,
        reachAt,
        panelUrl: panelUrl(config, inbound.contactId),
      }));
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
      after(() => createLeadNotifier(config.notify, secrets).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: result.state.history,
        captured: result.capturedLead,
        reachAt,
        panelUrl: panelUrl(config, inbound.contactId),
      }));
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
      after(() => createLeadNotifier(config.notify, secrets).notify({
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: result.state.history,
        booking: result.booked,
        reachAt,
        panelUrl: panelUrl(config, inbound.contactId),
      }));
    }
  } catch (error) {
    console.error(`[${config.id}] whatsapp failed`, error);
  }

  return new Response('ok', { status: 200 });
}

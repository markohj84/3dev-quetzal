import { NextResponse, after } from 'next/server';
import { assistantFor, getAssistantOrNull, tenantByPhoneNumberId, type Assistant } from '../../assistant';
import { createWhatsAppAdapter, failedDeliveries, ownerEchoes, toMetaRecipient, verifySignature } from '../../../core/channels/whatsapp';
import { quotePilotFor, pilotReply, asksForStatus, boundChat } from '../../../core/channels/quote-pilot';
import { orderSettings, newOrder, requestedQuantity, selectedQuantity, requestedFolio, orderSummary, orderText, orderReceipts, markNotification } from '../../../core/channels/order-pilot';
import { orderStore } from '../../../core/store/order-store';
import type { ChannelAdapter, InboundMessage } from '../../../core/channels/types';
import { createSessionStore, createRateLimiter, claimMessage, finishMessage, withTurn, quoteBinding } from '../../../core/store/session-store';
import { createConversationLog, createLeadStore, createFollowUpStore, createProfileStore, createHandoffStore, createUsageLog } from '../../../core/store/db';
import { isTaken, shouldNotify } from '../../../core/handoff';
import { withStart } from '../../../core/engine/prompt';
import { panelUrl } from '../../panel/links';
import { createLeadNotifier } from '../../../core/notify';
import { leadPhone } from '../../../core/followup';
import { reportFailure } from '../../failure';

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

  const adapter = createWhatsAppAdapter({
    phoneNumberId: secrets.whatsapp.phoneNumberId ?? '',
    accessToken: secrets.whatsapp.token ?? '',
  });
  const inbound = adapter.parse(parsed);
  // Meta accepted a send and reports here, later, that it never arrived: the only notice there is.
  const receipts = orderReceipts(parsed, secrets.whatsapp.phoneNumberId);
  if (receipts.length) {
    const pilot = quotePilotFor(config.id);
    if (pilot && Date.now() < pilot.expiresAt * 1000 && orderSettings(config.id, pilot.digest)) {
      const store = orderStore(config.id, pilot.digest, pilot.expiresAt);
      for (const receipt of receipts) {
        await markNotification(store.forFolio(receipt.folio), receipt.folio, receipt.area, receipt.attempt, receipt.status);
      }
    }
  }
  const [failed] = failedDeliveries(parsed);
  if (failed) {
    const alert = { channel: 'whatsapp', contactId: failed.recipient, transcript: [], reachAt: `https://wa.me/${failed.recipient}` };
    await reportFailure({ config, secrets }, alert, undefined, failed.error);
  }
  for (const echo of ownerEchoes(parsed)) await ownerWrote(config.id, echo);
  // Meta retries anything that is not a 200, including delivery receipts.
  if (!inbound) return new Response('ok', { status: 200 });

  if (!(await rateLimiter.check(`${config.id}:${inbound.contactId}`))) {
    return new Response('ok', { status: 200 });
  }

  // Meta sends a message again when this takes long or fails. A copy of one already
  // handled is dropped; a copy of one still being handled gets a 503, so Meta comes
  // back later and finds it done, or handles it if that first delivery died.
  // A mark that cannot be read must not cost the person their answer.
  const claim = inbound.id ? await claimMessage(config.id, inbound.id).catch(() => 'new' as const) : 'new';
  if (claim === 'done') return new Response('ok', { status: 200 });
  if (claim === 'busy') return new Response('busy', { status: 503 });
  const finish = async () => {
    if (inbound.id) await finishMessage(config.id, inbound.id).catch((error) => console.error(`[${config.id}] inbound mark failed`, error));
  };

  // One conversation, one reply at a time: a second message waits for the first to be answered.
  return withTurn(config.id, inbound.contactId, () => answer({ engine, config, secrets }, adapter, inbound, finish));
}

/**
 * The owner answered from the WhatsApp Business app on this same number: the
 * conversation is theirs, as if taken in the panel, and what they wrote goes
 * where the panel's replies go (transcript and session). Each write fails on
 * its own: a lost line beats a lost take, which would let the assistant talk over them.
 */
async function ownerWrote(clientId: string, echo: ReturnType<typeof ownerEchoes>[number]): Promise<void> {
  // Meta repeats a webhook it thinks failed: one echo, one line.
  const claim = echo.id ? await claimMessage(clientId, echo.id).catch(() => 'new' as const) : 'new';
  if (claim !== 'new') return;
  const now = new Date();
  const log = (what: string) => (error: unknown) => console.error(`[${clientId}] owner echo: ${what} failed`, error);
  await withTurn(clientId, echo.contactId, async () => {
    // First: it creates the contact the take points to.
    await createConversationLog(clientId).appendHuman({ channel: 'whatsapp', contactId: echo.contactId, text: echo.text, at: now }).catch(log('log'));
    await createHandoffStore(clientId).takeFromPhone(echo.contactId, now).catch(log('take'));
    // The business said it: when the assistant takes over again, it is its own side of the thread.
    const sessions = createSessionStore(clientId);
    try {
      const state = (await sessions.get(echo.contactId)) ?? { history: [], hasOffered: false };
      await sessions.set(echo.contactId, { ...withStart(state, now), history: [...state.history, { role: 'assistant', content: echo.text }] });
    } catch (error) {
      log('session append')(error);
    }
  });
  if (echo.id) await finishMessage(clientId, echo.id).catch(log('mark'));
}

async function answer(
  { engine, config, secrets }: Pick<Assistant, 'engine' | 'config' | 'secrets'>,
  adapter: ChannelAdapter,
  inbound: InboundMessage,
  finish: () => Promise<void>,
): Promise<Response> {
  // Explicit pilot commands use the signed sender and do not enter the sales transcript.
  const pilot = quotePilotFor(config.id);
  if (pilot) {
    try {
      const binding = quoteBinding(config.id, pilot.digest, pilot.expiresAt);
      const setup = orderSettings(config.id, pilot.digest);
      const text = inbound.text.trim();
      let reply: string | null = null;
      if (setup && Date.now() < pilot.expiresAt * 1000) {
        const quantity = requestedQuantity(text, setup);
        const selection = selectedQuantity(text, setup);
        const folio = requestedFolio(text);
        const summary = asksForStatus(text);
        if ((quantity || selection !== null || folio || summary) && await binding.owner() === boundChat(pilot.digest, inbound.contactId)) {
          const book = orderStore(config.id, pilot.digest, pilot.expiresAt);
          if (quantity) {
            if (inbound.id) {
              const order = await newOrder(book, setup, inbound.contactId, quantity, inbound.id);
              reply = 'Solicitud registrada.\n' + orderText(order, setup.business);
            } else {
              reply = 'Vuelve a enviar el pedido para que pueda registrarlo con su folio.';
            }
          } else if (folio) {
            const order = await book.forFolio(folio).read();
            reply = order ? orderText(order, setup.business)
              : folio === pilot.folio ? pilot.reply : 'No encontré ese folio en tus pedidos.';
          } else {
            reply = orderSummary(await book.list(), setup.business, selection);
          }
        }
      }
      reply ??= await pilotReply(pilot, binding, inbound.contactId, text);
      if (reply !== null) {
        await adapter.deliver(inbound.contactId, { text: reply });
        await finish();
        return new Response('ok');
      }
    } catch {
      // Keep the claim retryable when Redis or delivery fails. Never send the invitation to the model.
      return new Response('retry', { status: 503 });
    }
  }

  const sessions = createSessionStore(config.id);
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
  // Heard, not answered (the owner has the conversation, or the assistant failed):
  // the message stays in the log, and in the session for whoever answers next.
  const keepUnanswered = async () => {
    await createConversationLog(config.id)
      .appendInbound({ channel: 'whatsapp', contactId: inbound.contactId, userText: inbound.text, at: now })
      .catch((error) => console.error(`[${config.id}] conversation log failed`, error));
    // In the session too, so the assistant has the whole thread when it takes over again.
    // A Redis error must still answer 200: Meta's retries would duplicate the row and the alert.
    await sessions
      // withStart: a session born here must still mark its start, or this thread comes back as "earlier".
      .set(inbound.contactId, { ...withStart(state, now), history: [...state.history, { role: 'user', content: inbound.text }] })
      .catch((error) => console.error(`[${config.id}] session append failed`, error));
  };
  if (handoff && isTaken(handoff, now)) {
    await keepUnanswered();
    // Taken from the phone, the message is already on the owner's phone: no paid alert for it.
    if (handoff.taken_by && shouldNotify(handoff, now)) {
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
    await finish();
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
    const reachAt = `https://wa.me/${toMetaRecipient(inbound.contactId)}`;
    // A failed send (expired token, billing, Meta outage) must not also lose
    // the log, the lead and the alert: what the person said still happened.
    // They got no answer, though, so someone has to hear of it.
    await adapter.deliver(inbound.contactId, result.reply).catch(async (error) => {
      console.error(`[${config.id}] whatsapp delivery failed`, error);
      const alert = { channel: 'whatsapp', contactId: inbound.contactId, transcript: state.history, reachAt, panelUrl: panelUrl(config, inbound.contactId) };
      await reportFailure({ config, secrets }, alert, inbound.text, error);
    });
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
    await keepUnanswered();
    await reportFailure(
      { config, secrets },
      {
        channel: 'whatsapp',
        contactId: inbound.contactId,
        transcript: state.history,
        reachAt: `https://wa.me/${toMetaRecipient(inbound.contactId)}`,
        panelUrl: panelUrl(config, inbound.contactId),
      },
      inbound.text,
      error,
    );
  }

  await finish();
  return new Response('ok', { status: 200 });
}

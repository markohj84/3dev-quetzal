import { NextResponse } from 'next/server';
import { getAssistant } from '../../assistant';
import { createWebAdapter } from '../../../core/channels/web';
import { createSessionStore, createRateLimiter } from '../../../core/store/session-store';
import { createConversationLog, createLeadStore, createFollowUpStore } from '../../../core/store/db';
import { createLeadNotifier } from '../../../core/notify';
import { leadPhone } from '../../../core/followup';
import { panelUrl } from '../../panel/links';

const adapter = createWebAdapter();
const sessions = createSessionStore();
// Keyed by IP, not sessionId: the widget mints a fresh sessionId per page load,
// so a session-scoped limit costs an attacker nothing to bypass.
const rateLimiter = createRateLimiter(20, 60);

export async function POST(request: Request) {
  const { engine, config } = await getAssistant();

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await rateLimiter.check(ip))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  const inbound = adapter.parse(await request.json().catch(() => null));
  if (!inbound) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const state = (await sessions.get(inbound.contactId)) ?? { history: [], hasOffered: false };

  try {
    const result = await engine.respond(state, inbound.text, adapter);
    await sessions.set(inbound.contactId, result.state);
    // The log is a record, not the reply: a database hiccup must not cost the person their answer.
    await createConversationLog(config.id)
      .append({
        channel: 'web',
        contactId: inbound.contactId,
        userText: inbound.text,
        assistantText: result.reply.text,
        at: new Date(),
      })
      .catch((error) => console.error(`[${config.id}] conversation log failed`, error));

    if (!state.hasOffered && result.state.hasOffered) {
      await createLeadNotifier(config.notify).notify({
        channel: 'web',
        contactId: inbound.contactId,
        transcript: result.state.history,
        panelUrl: panelUrl(inbound.contactId),
      });
    }

    if (result.capturedLead) {
      // The alert below carries the same data: a failed save must not also lose it.
      await createLeadStore(config.id)
        .save({
          ...result.capturedLead,
          channel: 'web',
          contactId: inbound.contactId,
          at: new Date().toISOString(),
        })
        .catch((error) => console.error(`[${config.id}] lead save failed`, error));
      await createLeadNotifier(config.notify).notify({
        channel: 'web',
        contactId: inbound.contactId,
        transcript: result.state.history,
        panelUrl: panelUrl(inbound.contactId),
        captured: result.capturedLead,
      });
    }

    if (result.booked) {
      // Booked people need no follow-up nudge.
      const phone = leadPhone(
        { nombre: '', contacto: result.booked.telefono ?? '', channel: 'web', contactId: inbound.contactId, at: '' },
        config.followUp?.countryCode,
      );
      // The meeting exists either way; worst case is one extra nudge, never a lost alert.
      if (phone) {
        await createFollowUpStore(config.id)
          .mark(phone, 'booked')
          .catch((error) => console.error(`[${config.id}] follow-up mark failed`, error));
      }
      await createLeadNotifier(config.notify).notify({
        channel: 'web',
        contactId: inbound.contactId,
        transcript: result.state.history,
        panelUrl: panelUrl(inbound.contactId),
        booking: result.booked,
      });
    }

    return NextResponse.json({
      text: result.reply.text,
      chips: state.history.length === 0 ? config.channels.web.openers : [],
    });
  } catch (error) {
    console.error(`[${config.id}] chat failed`, error);
    return NextResponse.json({ error: 'assistant unavailable' }, { status: 502 });
  }
}

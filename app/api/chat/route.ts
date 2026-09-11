import { NextResponse } from 'next/server';
import { getAssistant } from '../../assistant';
import { createWebAdapter } from '../../../core/channels/web';
import { createSessionStore, createRateLimiter, createConversationLog, createLeadStore } from '../../../core/store/session-store';
import { createLeadNotifier } from '../../../core/notify';

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
    await createConversationLog(config.id).append({
      channel: 'web',
      contactId: inbound.contactId,
      userText: inbound.text,
      assistantText: result.reply.text,
      at: new Date(),
    });

    if (!state.hasOffered && result.state.hasOffered) {
      await createLeadNotifier(config.notify.email, config.notify.fromEmail).notify({
        channel: 'web',
        contactId: inbound.contactId,
        transcript: result.state.history,
      });
    }

    if (result.capturedLead) {
      await createLeadStore(config.id).save({
        ...result.capturedLead,
        channel: 'web',
        contactId: inbound.contactId,
        at: new Date().toISOString(),
      });
      await createLeadNotifier(config.notify.email, config.notify.fromEmail).notify({
        channel: 'web',
        contactId: inbound.contactId,
        transcript: result.state.history,
        captured: result.capturedLead,
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

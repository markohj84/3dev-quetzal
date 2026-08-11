import { NextResponse } from 'next/server';
import { getAssistant } from '../../assistant';
import { createWebAdapter } from '../../../core/channels/web';
import type { ConversationState } from '../../../core/engine';

const adapter = createWebAdapter();

/** In-memory for the prototype. Swap for Redis or Postgres before launch. */
const sessions = new Map<string, ConversationState>();

export async function POST(request: Request) {
  const { engine, config } = await getAssistant();

  const inbound = adapter.parse(await request.json().catch(() => null));
  if (!inbound) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const state = sessions.get(inbound.contactId) ?? { history: [], hasOffered: false };

  try {
    const result = await engine.respond(state, inbound.text, adapter);
    sessions.set(inbound.contactId, result.state);

    return NextResponse.json({
      text: result.reply.text,
      chips: state.history.length === 0 ? config.channels.web.openers : [],
    });
  } catch (error) {
    console.error(`[${config.id}] chat failed`, error);
    return NextResponse.json({ error: 'assistant unavailable' }, { status: 502 });
  }
}

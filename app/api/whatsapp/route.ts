import { NextResponse } from 'next/server';
import { getAssistant } from '../../assistant';
import { createWhatsAppAdapter } from '../../../core/channels/whatsapp';
import type { ConversationState } from '../../../core/engine';

/** Replace both maps with real storage before this handles live traffic. */
const sessions = new Map<string, ConversationState>();
const lastInbound = new Map<string, Date>();

const adapter = createWhatsAppAdapter({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
  lastInboundAt: async (id) => lastInbound.get(id) ?? null,
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

  const inbound = adapter.parse(await request.json().catch(() => null));
  // Meta retries anything that is not a 200, including delivery receipts.
  if (!inbound) return new Response('ok', { status: 200 });

  lastInbound.set(inbound.contactId, inbound.receivedAt);
  const state = sessions.get(inbound.contactId) ?? { history: [], hasOffered: false };

  try {
    const result = await engine.respond(state, inbound.text, adapter);
    sessions.set(inbound.contactId, result.state);
    await adapter.deliver(inbound.contactId, result.reply);
  } catch (error) {
    console.error(`[${config.id}] whatsapp failed`, error);
  }

  return new Response('ok', { status: 200 });
}

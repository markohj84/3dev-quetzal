import assert from 'node:assert';
import Anthropic from '@anthropic-ai/sdk';
import type { AssistantConfig } from '../config/schema';
import type { ChannelAdapter, OutboundMessage } from '../channels/types';
import type { Scheduler } from '../scheduling/types';
import type { Corpus } from './knowledge';
import { buildSystemPrompt } from './prompt.ts';
import { captureLeadTool, offerMeetingTool, type CapturedLead } from '../tools.ts';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationState {
  history: Turn[];
  hasOffered: boolean;
}

/** A tool round-trip stays inside one respond() call — the model calls a
 * tool, gets the result, and answers, without that back-and-forth becoming
 * part of the persisted history. Bounds how many times it can loop before
 * we force it to just answer with whatever text it has. */
const MAX_TOOL_ROUNDS = 3;

export interface EngineDeps {
  config: AssistantConfig;
  voice: string;
  corpus: Corpus;
  scheduler: Scheduler;
  client: Anthropic;
}

export function createEngine(deps: EngineDeps) {
  const { config, voice, corpus, scheduler, client } = deps;

  if (corpus.estimatedTokens > config.model.corpusWarnTokens) {
    console.warn(
      `[${config.id}] corpus is ~${corpus.estimatedTokens} tokens, above the ` +
        `${config.model.corpusWarnTokens} ceiling. Move this client to retrieval.`,
    );
  }

  return {
    async respond(
      state: ConversationState,
      userText: string,
      adapter: ChannelAdapter,
    ): Promise<{ reply: OutboundMessage; state: ConversationState; capturedLead?: CapturedLead }> {
      const history: Turn[] = [...state.history, { role: 'user', content: userText }];

      const systemPrompt = buildSystemPrompt({
        config,
        voice,
        corpus,
        capabilities: adapter.capabilities,
        scheduler,
        hasOffered: state.hasOffered,
      });

      const system = [
        // Cached as one block: voice + knowledge dominate the token count and
        // are identical across every turn and every user of this client, so
        // caching the whole prompt still captures most of the saving without
        // restructuring buildSystemPrompt's boundary contract. The prompt
        // does shift once, when hasOffered flips true — that turn re-writes
        // the cache; every turn after it hits again.
        { type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } },
      ];

      let messages: Anthropic.MessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));
      let text = '';
      let capturedLead: CapturedLead | undefined;
      let offeredNow = state.hasOffered;

      // The offer is enforced by withholding the tool, not by asking the model
      // to remember it already offered. Once hasOffered is true the link has
      // no code path left, so it cannot be offered twice however the
      // conversation is steered.
      const canOffer = scheduler.provider !== 'none' && !state.hasOffered;
      const tools = canOffer ? [captureLeadTool, offerMeetingTool] : [captureLeadTool];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await client.messages.create({
          model: config.model.model,
          max_tokens: config.model.maxTokens,
          system,
          tools,
          messages,
        });

        const toolUses = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
        );

        text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim();

        if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break;

        messages = [
          ...messages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: toolUses.map((block) => {
              if (block.name === 'capture_lead') {
                capturedLead = block.input as CapturedLead;
              }
              if (block.name === 'offer_meeting') {
                offeredNow = true;
                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  // The link rides along for the case where the person accepts
                  // in the same breath ("sí, quiero agendar ya"); otherwise it
                  // waits for the turn after the invitation.
                  content:
                    'Invitación registrada: ya no podrás volver a ofrecerla. Hazla en una línea. ' +
                    `Si la persona acepta, comparte este link tal cual: ${scheduler.bookingUrl()}`,
                };
              }
              return { type: 'tool_result' as const, tool_use_id: block.id, content: 'ok' };
            }),
          },
        ];
      }

      if (!text) {
        // The model can end a round on a tool_use block with no text — rare,
        // but if it happens on every round up to MAX_TOOL_ROUNDS, the loop
        // exits with nothing to say. Force one plain answer rather than
        // showing the person an empty message.
        const fallback = await client.messages.create({
          model: config.model.model,
          max_tokens: config.model.maxTokens,
          system,
          messages,
        });
        text =
          fallback.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
            .trim() || 'Perdón, se me cruzaron los cables. ¿Me repites tu pregunta?';
      }

      return {
        reply: { text },
        state: {
          history: [...history, { role: 'assistant', content: text }],
          hasOffered: offeredNow,
        },
        capturedLead,
      };
    },
  };
}

// Self-check: `node core/engine/conversation.ts`
if (import.meta.url === `file://${process.argv[1]}`) {

  const LINK = 'https://calendly.com/equipo/30min';

  const config = {
    id: 'selfcheck',
    model: { model: 'stub', maxTokens: 256, corpusWarnTokens: 40_000 },
    scheduling: { provider: 'calendly', url: LINK, durationMinutes: 30, maxOffers: 1 },
    outOfScope: [],
  } as unknown as AssistantConfig;
  const calendly: Scheduler = { provider: 'calendly', bookingUrl: () => LINK };
  const noScheduler: Scheduler = { provider: 'none', bookingUrl: () => '' };

  /** Replays canned responses and records the tools it was offered. */
  function fakeClient(responses: any[]) {
    const toolsSeen: string[][] = [];
    return {
      toolsSeen,
      messages: {
        create: async ({ tools }: any) => {
          toolsSeen.push((tools ?? []).map((t: any) => t.name));
          return responses.shift();
        },
      },
    };
  }

  const wantsToOffer = [
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'offer_meeting', input: {} }],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: `Va, aquí lo agendas: ${LINK}` }] },
  ];

  const adapter = {
    capabilities: { maxLength: 4000, maxChips: 4, hasSendWindow: false, markup: 'html' },
  } as any;
  const corpus = { text: 'Cobramos por proyecto.', estimatedTokens: 10, files: ['x.md'] };
  const engineFor = (client: any) =>
    createEngine({ config, voice: 'Sé breve.', corpus, scheduler: calendly, client });

  // Fresh conversation: the tool is on the table, and using it flips the state.
  const first = fakeClient(structuredClone(wantsToOffer));
  const fresh = await engineFor(first).respond({ history: [], hasOffered: false }, 'me interesa', adapter);
  assert.ok(first.toolsSeen[0].includes('offer_meeting'), 'should offer the tool before offering');
  assert.equal(fresh.state.hasOffered, true, 'calling the tool must flip hasOffered');
  assert.ok(fresh.reply.text.includes(LINK), 'the link should reach the reply');

  // The old regex could be fooled by the assistant merely saying "agendar".
  // Now only the tool call counts.
  const talker = fakeClient([
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Podrías agendar con Calendly luego.' }] },
  ]);
  const chatty = await engineFor(talker).respond({ history: [], hasOffered: false }, 'hola', adapter);
  assert.equal(chatty.state.hasOffered, false, 'merely saying "agendar" must not count as offering');

  // Already offered: the tool is gone, so a second offer has no code path.
  const second = fakeClient([
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Con gusto te explico.' }] },
  ]);
  const later = await engineFor(second).respond({ history: [], hasOffered: true }, 'y luego?', adapter);
  assert.ok(!second.toolsSeen[0].includes('offer_meeting'), 'the tool must be withheld once offered');
  assert.equal(later.state.hasOffered, true, 'hasOffered must stay true');

  // No scheduler configured: never offer, whatever the model does.
  const nullEngine = createEngine({
    config,
    voice: 'Sé breve.',
    corpus,
    scheduler: noScheduler,
    client: fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hola.' }] }]) as any,
  });
  const none = await nullEngine.respond({ history: [], hasOffered: false }, 'hola', adapter);
  assert.equal(none.state.hasOffered, false, 'no scheduler means no offer');

  console.log('conversation.ts self-check passed');
}

import Anthropic from '@anthropic-ai/sdk';
import type { AssistantConfig } from '../config/schema';
import type { ChannelAdapter, OutboundMessage } from '../channels/types';
import type { Scheduler } from '../scheduling/types';
import type { Corpus } from './knowledge';
import { buildSystemPrompt } from './prompt';
import { captureLeadTool, type CapturedLead } from '../tools';

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
  const offerPattern = new RegExp(config.scheduling.offerPattern, 'i');

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

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await client.messages.create({
          model: config.model.model,
          max_tokens: config.model.maxTokens,
          system,
          tools: [captureLeadTool],
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
              return { type: 'tool_result' as const, tool_use_id: block.id, content: 'ok' };
            }),
          },
        ];
      }

      const offeredNow =
        state.hasOffered || (scheduler.provider !== 'none' && offerPattern.test(text));

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

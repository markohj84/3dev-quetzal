import Anthropic from '@anthropic-ai/sdk';
import type { AssistantConfig } from '../config/schema';
import type { ChannelAdapter, OutboundMessage } from '../channels/types';
import type { Scheduler } from '../scheduling/types';
import type { Corpus } from './knowledge';
import { buildSystemPrompt } from './prompt';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationState {
  history: Turn[];
  hasOffered: boolean;
}

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
    ): Promise<{ reply: OutboundMessage; state: ConversationState }> {
      const history: Turn[] = [...state.history, { role: 'user', content: userText }];

      const systemPrompt = buildSystemPrompt({
        config,
        voice,
        corpus,
        capabilities: adapter.capabilities,
        scheduler,
        hasOffered: state.hasOffered,
      });

      const response = await client.messages.create({
        model: config.model.model,
        max_tokens: config.model.maxTokens,
        // Cached as one block: voice + knowledge dominate the token count and
        // are identical across every turn and every user of this client, so
        // caching the whole prompt still captures most of the saving without
        // restructuring buildSystemPrompt's boundary contract. The prompt
        // does shift once, when hasOffered flips true — that turn re-writes
        // the cache; every turn after it hits again.
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: history.map((t) => ({ role: t.role, content: t.content })),
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      const offeredNow =
        state.hasOffered || (scheduler.provider !== 'none' && offerPattern.test(text));

      return {
        reply: { text },
        state: {
          history: [...history, { role: 'assistant', content: text }],
          hasOffered: offeredNow,
        },
      };
    },
  };
}

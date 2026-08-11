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

      const response = await client.messages.create({
        model: config.model.model,
        max_tokens: config.model.maxTokens,
        system: buildSystemPrompt({
          config,
          voice,
          corpus,
          capabilities: adapter.capabilities,
          scheduler,
          hasOffered: state.hasOffered,
        }),
        messages: history.map((t) => ({ role: t.role, content: t.content })),
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      const offeredNow =
        state.hasOffered || (scheduler.provider !== 'none' && mentionsMeeting(text));

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

/**
 * The one-offer rule is enforced in state, not left to the model's memory.
 * A model asked politely not to repeat itself will still repeat itself.
 */
function mentionsMeeting(text: string): boolean {
  return /calendly|cal\.com|agendar|agendo|schedule|booking/i.test(text);
}

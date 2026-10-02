import Anthropic from '@anthropic-ai/sdk';
import type { AssistantConfig } from '../config/schema';
import type { ChannelAdapter, OutboundMessage } from '../channels/types';
import type { Scheduler } from '../scheduling/types';
import type { Corpus } from './knowledge';
import { buildSystemPrompt } from './prompt';
import { captureLeadTool, checkAvailabilityTool, type CapturedLead } from '../tools';

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

  /**
   * Never hands back an empty answer: if the calendar cannot be reached the
   * model is told to fall back to the link, because the one thing it must not
   * do is make a time up.
   */
  async function availabilityText(): Promise<string> {
    const link = `Si la persona elige uno, compártele este link para confirmarlo: ${scheduler.bookingUrl()}`;
    const zone = config.scheduling.timeZoneLabel;

    // Whatever went wrong is ours, not the prospect's: they get the link and
    // an ordinary sentence, never a report that something is broken.
    const sinHorarios =
      'No hay horarios que proponer en este momento. No inventes ninguno y no menciones ' +
      `ningún problema técnico ni que no pudiste consultar el calendario. Ofrece con naturalidad que la persona elija el día y la hora que le acomode: ${scheduler.bookingUrl()}`;

    try {
      const slots = await scheduler.availability!();
      if (!slots.length) return sinHorarios;

      // El rótulo de zona va pegado al primer horario, como dato que el
      // modelo copia, no como instrucción que puede omitir — en producción la
      // omitió, y una hora sin zona es una junta perdida.
      return [
        'Horarios libres:',
        ...slots.map((s, i) => (i === 0 && zone ? `- ${s} (${zone})` : `- ${s}`)),
        link,
      ].join('\n');
    } catch (error) {
      console.error(`[${config.id}] availability lookup failed`, error);
      return sinHorarios;
    }
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
      let proposedTimes = false;

      const tools = scheduler.availability
        ? [captureLeadTool, checkAvailabilityTool]
        : [captureLeadTool];

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

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUses) {
          if (block.name === 'capture_lead') {
            capturedLead = block.input as CapturedLead;
          }
          if (block.name === 'check_availability') {
            // Proposing times is the offer, whatever words wrap them.
            proposedTimes = true;
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: await availabilityText(),
            });
            continue;
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: 'ok' });
        }

        messages = [
          ...messages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: results },
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

      const offeredNow =
        state.hasOffered ||
        proposedTimes ||
        (scheduler.provider !== 'none' && offerPattern.test(text));

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

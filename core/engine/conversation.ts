import Anthropic from '@anthropic-ai/sdk';
import type { AssistantConfig } from '../config/schema';
import type { ChannelAdapter, OutboundMessage } from '../channels/types';
import type { Scheduler } from '../scheduling/types';
import type { Booking } from '../scheduling/calendly-webhook';
import type { Corpus } from './knowledge';
import { buildContactNote, buildSystemPrompt, withStart, type KnownContact } from './prompt';
import {
  bookMeetingTool,
  captureLeadTool,
  catalogTool,
  checkAvailabilityTool,
  hasNewContact,
  rememberContactTool,
  type BookMeetingInput,
  type CapturedLead,
  type RememberedContact,
} from '../tools';
import { CATALOG_UNAVAILABLE, describeCatalog, type Catalog } from '../catalog';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationState {
  history: Turn[];
  hasOffered: boolean;
  /** When this conversation began; earlier messages are memory, not session. */
  startedAt?: string;
}

/** A tool round-trip stays inside one respond() call — the model calls a
 * tool, gets the result, and answers, without that back-and-forth becoming
 * part of the persisted history. Bounds how many times it can loop before
 * we force it to just answer with whatever text it has. */
const MAX_TOOL_ROUNDS = 5;

export interface EngineDeps {
  config: AssistantConfig;
  voice: string;
  corpus: Corpus;
  scheduler: Scheduler;
  client: Anthropic;
  catalog?: Catalog;
}

export function createEngine(deps: EngineDeps) {
  const { config, voice, corpus, scheduler, client, catalog } = deps;
  const offerPattern = new RegExp(config.scheduling.offerPattern, 'i');
  const { model, maxTokens, effort } = config.model;
  const modelParams = {
    model,
    max_tokens: maxTokens,
    ...(effort ? { output_config: { effort } } : {}),
  };

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
    const link = scheduler.book
      ? `Si la persona elige uno, agéndalo con book_meeting. Si ninguno le acomoda, compártele este link para que elija otro: ${scheduler.bookingUrl()}`
      : `Si la persona elige uno, compártele este link para confirmarlo: ${scheduler.bookingUrl()}`;
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

  /** What the model reads back after book_meeting: the calendar's answer, never a guess. */
  async function bookingText(input: BookMeetingInput, phone?: string): Promise<{ text: string; booking?: Booking }> {
    const zone = config.scheduling.timeZoneLabel;
    try {
      const outcome = await scheduler.book!(
        { month: input.mes, day: input.dia, time: input.hora },
        { nombre: input.nombre, email: input.email, telefono: input.telefono ?? phone, notas: input.notas },
      );
      if ('missing' in outcome) {
        return {
          text: `NO quedó agendada: el calendario necesita su ${outcome.missing}. No digas que está agendada ni confirmada. Pídele su ${outcome.missing} y vuelve a llamar book_meeting con el mismo horario.`,
        };
      }
      if (!outcome.booked) {
        return { text: `Ese horario ya no está libre. No lo des por agendado. ${await availabilityText()}` };
      }
      const label = zone ? `${outcome.label} (${zone})` : outcome.label;
      return {
        text:
          `Cita confirmada en el calendario: ${label}. ` +
          (input.email
            ? 'Le llegará la invitación a su correo. '
            : 'No dejó correo, así que no recibirá invitación: confírmale aquí el día y la hora. ') +
          'No prometas recordatorios ni que alguien le escribirá antes de la cita.',
        booking: {
          nombre: input.nombre,
          email: input.email,
          telefono: input.telefono ?? phone,
          evento: 'Agendada en el chat',
          inicia: label,
          contacto: input.notas,
        },
      };
    } catch (error) {
      console.error(`[${config.id}] booking failed`, error);
      return {
        text:
          'No se pudo agendar. No la des por agendada y no menciones ningún problema técnico: ' +
          `comparte con naturalidad este link para que elija el horario: ${scheduler.bookingUrl()}`,
      };
    }
  }

  async function catalogText(): Promise<string> {
    const today = new Intl.DateTimeFormat(config.locale, {
      dateStyle: 'full',
      timeZone: config.scheduling.timeZone,
    }).format(new Date());
    try {
      return describeCatalog(await catalog!.lookup(), today);
    } catch (error) {
      console.error(`[${config.id}] catalog lookup failed`, error);
      return CATALOG_UNAVAILABLE;
    }
  }

  return {
    async respond(
      state: ConversationState,
      userText: string,
      adapter: ChannelAdapter,
      contact: KnownContact = {},
    ): Promise<{
      reply: OutboundMessage;
      state: ConversationState;
      capturedLead?: CapturedLead;
      remembered?: RememberedContact;
      booked?: Booking;
    }> {
      state = withStart(state, new Date());
      const history: Turn[] = [...state.history, { role: 'user', content: userText }];

      const systemPrompt = buildSystemPrompt({
        config,
        voice,
        corpus,
        capabilities: adapter.capabilities,
        scheduler,
        hasOffered: state.hasOffered,
        hasCatalog: Boolean(catalog && config.catalog),
      });

      const system: Anthropic.TextBlockParam[] = [
        // Cached as one block: voice + knowledge dominate the token count and
        // are identical across every turn and every user of this client, so
        // caching the whole prompt still captures most of the saving without
        // restructuring buildSystemPrompt's boundary contract. The prompt
        // does shift once, when hasOffered flips true — that turn re-writes
        // the cache; every turn after it hits again.
        { type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } },
      ];
      const remembers = adapter.capabilities.stableContactId;
      const contactNote = remembers ? buildContactNote(contact, config.scheduling.timeZone) : null;
      // After the cache breakpoint, so the shared prefix still hits.
      if (contactNote) system.push({ type: 'text', text: contactNote });

      let messages: Anthropic.MessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));
      let text = '';
      let capturedLead: CapturedLead | undefined;
      let remembered: RememberedContact | undefined;
      let booked: Booking | undefined;
      let proposedTimes = false;
      // True while the model's last round asked for tools it hasn't read back yet.
      let toolsPending = false;

      // remember_contact sits before the scheduling tools: listed after
      // book_meeting, the model stopped calling it on the turn someone says
      // their name.
      const tools = [
        captureLeadTool,
        ...(remembers ? [rememberContactTool] : []),
        ...(catalog && config.catalog ? [catalogTool(config.catalog.description)] : []),
        ...(scheduler.availability ? [checkAvailabilityTool] : []),
        ...(scheduler.book ? [bookMeetingTool] : []),
      ];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await client.messages.create({
          ...modelParams,
          system,
          tools,
          messages,
        });

        const toolUses = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
        );

        const roundText = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim();
        // The model often writes its whole answer alongside a side-effect
        // tool (remember_contact) and then closes the next round with nothing.
        // That empty round must not erase the answer it already wrote.
        if (roundText) text = roundText;

        toolsPending = response.stop_reason === 'tool_use' && toolUses.length > 0;
        if (!toolsPending) break;

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUses) {
          if (block.name === 'capture_lead') {
            capturedLead = block.input as CapturedLead;
          }
          if (block.name === 'remember_contact') {
            remembered = { ...remembered, ...(block.input as RememberedContact) };
          }
          if (block.name === 'book_meeting') {
            proposedTimes = true;
            const result = await bookingText(block.input as BookMeetingInput, contact.phone);
            booked ??= result.booking;
            results.push({ type: 'tool_result', tool_use_id: block.id, content: result.text });
            continue;
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
          if (block.name === 'lookup_catalog') {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: await catalogText() });
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

      if (!text || toolsPending) {
        // The model can end a round on a tool_use block with no text — rare,
        // but if it happens on every round up to MAX_TOOL_ROUNDS, the loop
        // exits with nothing to say. Force one plain answer rather than
        // showing the person an empty message. Also when the rounds ran out
        // with tool results unread: a "déjame revisar" from round 0 must not
        // stand in for the booking confirmation the last tool returned.
        const fallback = await client.messages.create({
          ...modelParams,
          system,
          messages,
        });
        text =
          fallback.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
            .trim() ||
          text ||
          'Perdón, se me cruzaron los cables. ¿Me repites tu pregunta?';
      }

      const earlierUserTexts = state.history.filter((t) => t.role === 'user').map((t) => t.content);
      if (!capturedLead && hasNewContact(userText, earlierUserTexts)) {
        // The model sometimes says "quedamos anotados" without calling the
        // tool, and the person walks away believing someone will reach them.
        // Same tools and messages as the loop, so the cached prefix still hits.
        try {
          const forced = await client.messages.create({
            ...modelParams,
            system,
            tools,
            tool_choice: { type: 'tool', name: captureLeadTool.name },
            messages,
          });
          const use = forced.content.find(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
          );
          if (use) capturedLead = use.input as CapturedLead;
        } catch (error) {
          // The reply is already written; a failed capture must not take it down.
          console.error(`[${config.id}] forced capture_lead failed`, error);
        }
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
          startedAt: state.startedAt,
        },
        capturedLead,
        remembered,
        booked,
      };
    },
  };
}

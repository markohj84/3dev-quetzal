import type { AssistantConfig } from '../config/schema';
import type { ChannelCapabilities } from '../channels/types';
import type { Corpus } from './knowledge';
import type { Scheduler } from '../scheduling/types';

export interface PromptInput {
  config: AssistantConfig;
  voice: string;
  corpus: Corpus;
  capabilities: ChannelCapabilities;
  scheduler: Scheduler;
  /** True once the meeting has already been offered this conversation. */
  hasOffered: boolean;
}

/**
 * Assembles the system prompt. The client's voice document is inserted
 * verbatim and is never paraphrased or summarised here — it is the single
 * source of truth for tone, and rewriting it in code is how a client's
 * voice quietly drifts.
 */
export function buildSystemPrompt(input: PromptInput): string {
  const { config, voice, corpus, capabilities, scheduler, hasOffered } = input;

  const sections: string[] = [voice];

  sections.push(
    [
      '# Knowledge base',
      '',
      'The documents below are the only source of factual information you have.',
      'Never state a figure, date, duration, name, or result that does not appear',
      'in them. If asked for something absent, say you do not have it at hand and',
      'offer that the team can answer directly. An invented',
      'detail from an assistant reads as a promise from the business.',
      '',
      corpus.text || '(empty — decline all factual questions)',
    ].join('\n'),
  );

  if (config.outOfScope.length) {
    sections.push(
      ['# Out of scope', '', ...config.outOfScope.map((t) => `- ${t}`)].join('\n'),
    );
  }

  const scheduling =
    scheduler.provider === 'none'
      ? 'Scheduling is unavailable. Do not offer a meeting.'
      : hasOffered
        ? `HARD CONSTRAINT: you already offered the meeting once this conversation. Do not offer it again under any wording — no "¿quieres agendar?", no "¿te gustaría platicar?", nothing that invites scheduling, even if the person asks how to start or shows strong interest again. Just answer what they asked. Only mention the meeting if they explicitly ask for the link or ask to schedule themselves — then share: ${scheduler.bookingUrl()}`
        : [
            `When the person shows real interest, offer a ${config.scheduling.durationMinutes}-minute`,
            'conversation with the team exactly once. Never name a specific person. If they accept,',
            `share this link: ${scheduler.bookingUrl()}`,
            'If they decline or ignore it, never bring it up again.',
          ].join(' ');

  const timesRule = scheduler.availability
    ? ' Never state a date or time you did not get from the `check_availability` tool this turn — not from the knowledge base, not from earlier in the conversation, not from your own sense of the calendar. Repeat what it returns verbatim.'
    : '';

  sections.push(`# Scheduling\n\n${scheduling}${timesRule}`);

  sections.push(
    [
      '# Format',
      '',
      `Keep replies under ${Math.floor(capabilities.maxLength * 0.25)} characters.`,
      capabilities.maxChips === 0
        ? 'This channel has no quick replies.'
        : `This channel renders at most ${capabilities.maxChips} quick replies.`,
      capabilities.markup === 'whatsapp'
        ? 'No headings, no tables. Put offer names and prices in **bold**. When comparing three or more options, use a short "- " list, one option per line, instead of one long paragraph.'
        : 'Short paragraphs. No headings.',
      'Ask at most one question per reply.',
    ].join('\n'),
  );

  return sections.join('\n\n---\n\n');
}

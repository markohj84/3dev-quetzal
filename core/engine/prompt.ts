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
      `offer that ${config.scheduling.hostName} can answer directly. An invented`,
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
        ? `You have already offered the meeting once. Do not offer it again. Keep answering what is asked. If the person asks for the link, share it: ${scheduler.bookingUrl()}`
        : [
            `When the person shows real interest, offer a ${config.scheduling.durationMinutes}-minute`,
            `conversation with ${config.scheduling.hostName} exactly once. If they accept,`,
            `share this link: ${scheduler.bookingUrl()}`,
            'If they decline or ignore it, never bring it up again.',
          ].join(' ');

  sections.push(`# Scheduling\n\n${scheduling}`);

  sections.push(
    [
      '# Format',
      '',
      `Keep replies under ${Math.floor(capabilities.maxLength * 0.25)} characters.`,
      capabilities.maxChips === 0
        ? 'This channel has no quick replies.'
        : `This channel renders at most ${capabilities.maxChips} quick replies.`,
      capabilities.markup === 'whatsapp'
        ? 'Plain text only. No headings, no bullet lists, no tables.'
        : 'Short paragraphs. No headings.',
      'Ask at most one question per reply.',
    ].join('\n'),
  );

  return sections.join('\n\n---\n\n');
}

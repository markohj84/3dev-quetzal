import { z } from 'zod';

/**
 * The boundary contract.
 *
 * Everything a client can change lives here. If a behaviour is not
 * expressible in this schema, it does not belong in core — it belongs
 * in the client's voice file or knowledge base.
 *
 * Rule of thumb: no file under core/ may name a specific client.
 */

export const SchedulingConfig = z.object({
  provider: z.enum(['calendly', 'none']),
  url: z.string().url().optional(),
  durationMinutes: z.number().int().positive().default(30),
  /** Offer the meeting at most this many times per conversation. */
  maxOffers: z.number().int().min(1).default(1),
});

export const ChannelConfig = z.object({
  web: z.object({
    enabled: z.boolean().default(true),
    /** Chips shown before the first user message. Empty disables them. */
    openers: z.array(z.string()).max(4).default([]),
  }),
  whatsapp: z.object({
    enabled: z.boolean().default(false),
    phoneNumberId: z.string().optional(),
    /** Approved Meta template used to reopen a conversation past 24h. */
    reengagementTemplate: z.string().optional(),
  }),
});

export const ModelConfig = z.object({
  model: z.string().default('claude-sonnet-4-6'),
  maxTokens: z.number().int().positive().default(1024),
  /** Corpus above this token estimate should move to retrieval. */
  corpusWarnTokens: z.number().int().positive().default(40_000),
});

export const AssistantConfig = z.object({
  /** Slug used for storage keys and logs. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** How the assistant refers to itself. */
  name: z.string(),
  /** Organisation the assistant represents. */
  organization: z.string(),
  locale: z.string().default('es-MX'),

  /** Path, relative to the client directory, of the voice document. */
  voiceFile: z.string().default('voice.md'),
  /** Directory, relative to the client directory, holding the corpus. */
  knowledgeDir: z.string().default('knowledge'),

  scheduling: SchedulingConfig,
  channels: ChannelConfig,
  model: ModelConfig.default({}),

  /**
   * Topics the assistant must decline. Declarative on purpose — never
   * encode a client's limits as branches in core logic.
   */
  outOfScope: z.array(z.string()).default([]),
});

export type AssistantConfig = z.infer<typeof AssistantConfig>;
export type SchedulingConfig = z.infer<typeof SchedulingConfig>;

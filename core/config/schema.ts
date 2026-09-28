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
  /**
   * Regex (case-insensitive) matched against the assistant's own reply to
   * detect that it just made the scheduling offer — must match the exact
   * phrasing voice.md uses, or `hasOffered` silently stops being
   * state-enforced and falls back to hoping the model doesn't repeat itself.
   */
  offerPattern: z.string().default('calendly|cal\\.com|agendar|agendo|schedule|booking'),
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

export const NotifyConfig = z.object({
  /** Address that receives a lead alert. Unset disables notifications. */
  email: z.string().email().optional(),
  /** "From" header for that alert — must be on a domain Resend has verified. */
  fromEmail: z.string().optional(),
});

export const ModelConfig = z.object({
  /**
   * Haiku by default: same anti-fabrication behaviour at a fraction of the
   * cost. Move a client to a larger model only if evals show it's needed.
   */
  model: z.string().default('claude-haiku-4-5-20251001'),
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
  notify: NotifyConfig.default({}),

  /**
   * Topics the assistant must decline. Declarative on purpose — never
   * encode a client's limits as branches in core logic.
   */
  outOfScope: z.array(z.string()).default([]),
});

export type AssistantConfig = z.infer<typeof AssistantConfig>;
export type SchedulingConfig = z.infer<typeof SchedulingConfig>;

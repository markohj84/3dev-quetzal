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
  provider: z.enum(['calendly', 'calcom', 'none']),
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
  /** Provider URI of the event type whose availability the assistant reads. */
  eventTypeUri: z.string().url().optional(),
  /** Cal.com's numeric event type id, the one its API books against. */
  eventTypeId: z.number().int().optional(),
  /** IANA zone the business speaks its times in, e.g. America/Mexico_City. */
  timeZone: z.string().optional(),
  /** How to say that zone out loud, e.g. "hora del centro de México". */
  timeZoneLabel: z.string().optional(),
  /** Earliest/latest hour, in the business's own time, the assistant may propose. */
  earliestHour: z.number().int().min(0).max(23).optional(),
  latestHour: z.number().int().min(1).max(24).optional(),
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
  }),
});

export const NotifyConfig = z.object({
  /** Address that receives a lead alert. Unset disables notifications. */
  email: z.string().email().optional(),
  /** "From" header for that alert — must be on a domain Resend has verified. */
  fromEmail: z.string().optional(),
  /**
   * Same alert on WhatsApp, sent from the client's own number. The assistant
   * writes first, so Meta only lets it through as an approved template with
   * four body variables: kind of alert, name, contact, detail.
   */
  whatsapp: z
    .object({
      /** Recipient in Meta's format, e.g. 52 + ten digits. Unset disables it. */
      to: z.string().optional(),
      template: z.string(),
      language: z.string().default('es_MX'),
    })
    .optional(),
});

/**
 * One WhatsApp message to someone who left a phone and never booked. The
 * business writes first, so it goes out as an approved template; `text` is
 * that template's body, written into the session so a reply has context.
 */
export const FollowUpConfig = z.object({
  afterHours: z.number().positive().default(24),
  template: z.string(),
  language: z.string().default('es_MX'),
  /** The template body with {nombre} where its one variable goes. */
  text: z.string(),
  /** Prefix for a ten-digit number typed in the web chat, e.g. "52". */
  countryCode: z.string().optional(),
});

export const ModelConfig = z.object({
  /**
   * Haiku by default: same anti-fabrication behaviour at a fraction of the
   * cost. Move a client to a larger model only if evals show it's needed.
   */
  model: z.string().default('claude-haiku-5-5'),
  /** Haiku 5.5 thinks by default and that thinking counts here: 1024 left
   * too little room for a full answer after it. */
  maxTokens: z.number().int().positive().default(2048),
  /**
   * Thinking depth. "low" is enough for a sales chat and keeps replies fast;
   * evals passed the same as Haiku 4.5 at about 1/7 of the cost. A client
   * moved back to a model older than Haiku 5.5 sets it to null — those
   * models reject the parameter.
   */
  effort: z.enum(['low', 'medium', 'high']).nullable().default('low'),
  /** Corpus above this token estimate should move to retrieval. */
  corpusWarnTokens: z.number().int().positive().default(40_000),
});

/**
 * Business data that changes too often for the knowledge base — promotions,
 * stock, current prices — read live from a Google Sheet published as CSV.
 * Only public data: anyone with the URL can read a published Sheet.
 */
export const CatalogConfig = z.object({
  /** File → Share → Publish to web → CSV. */
  url: z.string().url(),
  /** What the sheet holds, in the business's words. It is what makes the model call the tool. */
  description: z.string(),
  /** Rows past this are cut and logged: the sign to filter server-side. */
  maxRows: z.number().int().positive().default(300),
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
  followUp: FollowUpConfig.optional(),
  catalog: CatalogConfig.optional(),

  /**
   * Topics the assistant must decline. Declarative on purpose — never
   * encode a client's limits as branches in core logic.
   */
  outOfScope: z.array(z.string()).default([]),
});

export type AssistantConfig = z.infer<typeof AssistantConfig>;
export type SchedulingConfig = z.infer<typeof SchedulingConfig>;
export type NotifyConfig = z.infer<typeof NotifyConfig>;
export type CatalogConfig = z.infer<typeof CatalogConfig>;

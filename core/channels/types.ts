/**
 * Channel adapters translate a transport into the one shape the engine
 * understands, and translate the engine's reply back out.
 *
 * The engine must never learn which channel it is serving. Anything
 * channel-specific — WhatsApp's 24h window, template approval, message
 * length ceilings, markup dialect — is handled here.
 */

export interface InboundMessage {
  /** Stable identifier for the person across turns on this channel. */
  contactId: string;
  text: string;
  receivedAt: Date;
}

export interface OutboundMessage {
  text: string;
  /** Quick replies. Adapters degrade these to whatever the channel allows. */
  chips?: string[];
}

export interface ChannelCapabilities {
  /** Max characters per message before the adapter must split. */
  maxLength: number;
  /** How many quick-reply options the channel renders. Zero disables chips. */
  maxChips: number;
  /** True when the channel restricts unsolicited outbound messages. */
  hasSendWindow: boolean;
  markup: 'html' | 'whatsapp' | 'plain';
}

export interface ChannelAdapter {
  readonly name: string;
  readonly capabilities: ChannelCapabilities;

  /** Normalise a raw platform payload into an inbound message. */
  parse(payload: unknown): InboundMessage | null;

  /** Render an engine reply into the platform's own format and deliver it. */
  deliver(to: string, message: OutboundMessage): Promise<void>;

  /**
   * True when the assistant may send freely right now. Channels without a
   * send window always return true.
   */
  canSendFreely(contactId: string): Promise<boolean>;
}

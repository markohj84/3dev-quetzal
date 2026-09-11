import type { Turn } from './engine';

export interface LeadAlert {
  channel: string;
  contactId: string;
  transcript: Turn[];
}

export interface LeadNotifier {
  notify(alert: LeadAlert): Promise<void>;
}

/**
 * Fires once per conversation, the moment it crosses into "real interest"
 * (the same signal that flips hasOffered) — not on every turn. Uses
 * Resend's plain HTTP API directly; a single POST doesn't need the SDK.
 */
export function createLeadNotifier(to: string | undefined, from: string | undefined): LeadNotifier {
  return {
    async notify(alert) {
      if (!to || !from) return;

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        console.warn('RESEND_API_KEY no configurado — no se pudo notificar el lead');
        return;
      }

      const text = alert.transcript
        .map((t) => `${t.role === 'user' ? 'Prospecto' : 'Asistente'}: ${t.content}`)
        .join('\n\n');

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `Nuevo interés — canal ${alert.channel}`,
          text,
        }),
      });

      if (!res.ok) {
        console.error('Resend error', res.status, await res.text());
      }
    },
  };
}

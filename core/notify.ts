import type { Turn } from './engine';
import type { CapturedLead } from './tools';

export interface LeadAlert {
  channel: string;
  contactId: string;
  transcript: Turn[];
  /** Set when capture_lead was called this turn — puts real contact info front and center. */
  captured?: CapturedLead;
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

      const transcript = alert.transcript
        .map((t) => `${t.role === 'user' ? 'Prospecto' : 'Asistente'}: ${t.content}`)
        .join('\n\n');

      const header = alert.captured
        ? `Nombre: ${alert.captured.nombre}\nContacto: ${alert.captured.contacto}` +
          (alert.captured.necesidad ? `\nNecesidad: ${alert.captured.necesidad}` : '') +
          '\n\n---\n\n'
        : '';

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: alert.captured
            ? `Lead capturado — ${alert.captured.nombre} · canal ${alert.channel}`
            : `Nuevo interés — canal ${alert.channel}`,
          text: header + transcript,
        }),
      });

      if (!res.ok) {
        console.error('Resend error', res.status, await res.text());
      }
    },
  };
}

import type { Turn } from './engine';
import type { CapturedLead } from './tools';
import type { Booking } from './scheduling/calendly-webhook';

export interface LeadAlert {
  channel: string;
  contactId: string;
  transcript: Turn[];
  /** Set when capture_lead was called this turn — puts real contact info front and center. */
  captured?: CapturedLead;
  /** Set when the alert is a confirmed booking rather than interest. */
  booking?: Booking;
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

      // A booking arrives from the calendar, not from a conversation: there is
      // no transcript to attach and nothing for the reader to decide.
      const booking = alert.booking
        ? [
            `Nombre: ${alert.booking.nombre}`,
            `Correo: ${alert.booking.email}`,
            alert.booking.evento ? `Evento: ${alert.booking.evento}` : '',
            alert.booking.inicia ? `Cuándo: ${alert.booking.inicia}` : '',
            alert.booking.cancelUrl ? `Cancelar: ${alert.booking.cancelUrl}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : '';

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
          subject: alert.booking
            ? `Cita agendada — ${alert.booking.nombre}`
            : alert.captured
              ? `Lead capturado — ${alert.captured.nombre} · canal ${alert.channel}`
              : `Nuevo interés — canal ${alert.channel}`,
          text: booking || header + transcript,
        }),
      });

      if (!res.ok) {
        console.error('Resend error', res.status, await res.text());
      }
    },
  };
}

import type Anthropic from '@anthropic-ai/sdk';

export interface CapturedLead {
  nombre: string;
  contacto: string;
  necesidad?: string;
}

/**
 * The one tool every client instance has: turning "the model said someone
 * left contact info" into a structured record, instead of hoping it stays
 * legible buried in a free-text transcript. What happens with a captured
 * lead (storage, notification) is the caller's job — this only defines the
 * shape the model fills in.
 */
export const captureLeadTool: Anthropic.Tool = {
  name: 'capture_lead',
  description:
    'Registra a un prospecto en cuanto comparte su nombre y una forma de contacto (WhatsApp, teléfono o correo) — sin importar el motivo: quiere que el equipo lo contacte, preguntó algo que no se pudo responder, o quiere que le den seguimiento. Llámala una sola vez por persona en la conversación, con los datos más completos que tengas en ese momento.',
  input_schema: {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre que dio la persona' },
      contacto: { type: 'string', description: 'WhatsApp, teléfono o correo que compartió' },
      necesidad: { type: 'string', description: 'Resumen breve de qué busca, si se sabe' },
    },
    required: ['nombre', 'contacto'],
  },
};

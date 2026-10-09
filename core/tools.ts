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

/**
 * Real open times. Unlike the scheduling link, this is information the model
 * genuinely does not have — it is nowhere in voice.md or the knowledge base —
 * so the tool is the only way to answer, and that is what makes it get
 * called. Times are returned already worded, anchored to the business's
 * timezone, because the assistant cannot know the reader's.
 */
export const checkAvailabilityTool: Anthropic.Tool = {
  name: 'check_availability',
  description:
    'Consulta los horarios reales libres para la conversación con el equipo. Llámala antes de proponer cualquier horario. Nunca inventes fechas ni horas, ni las deduzcas de la base de conocimiento: si no llamaste esta herramienta, no tienes horarios. Devuelve los horarios ya redactados — compártelos tal cual, sin convertirlos a otra zona horaria.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export interface RememberedContact {
  nombre?: string;
  interes?: string;
}

/**
 * Only offered on channels where the contact id outlives the conversation —
 * remembering someone the next page load forgets is a wasted round-trip.
 */
export const rememberContactTool: Anthropic.Tool = {
  name: 'remember_contact',
  description:
    'Guarda lo mínimo para reconocer a esta persona si vuelve a escribir otro día: su nombre de pila, si lo dijo, y en pocas palabras qué le interesa (un servicio o el problema que quiere resolver). Llámala cuando aprendas cualquiera de los dos o cuando cambie. No guardes datos sensibles, precios ni el resto de la conversación. No reemplaza a capture_lead: esta herramienta no avisa al equipo, así que si la persona dejó un contacto, llama también capture_lead.',
  input_schema: {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre de pila que dijo la persona' },
      interes: { type: 'string', description: 'Qué le interesa, en menos de diez palabras' },
    },
    required: [],
  },
};

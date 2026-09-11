import { AssistantConfig } from '../../core/config/schema';

/**
 * 3dev — client instance.
 *
 * Everything specific to 3dev lives in this directory: this file, voice.md,
 * knowledge/, and theme.css. Adding a second client means copying this
 * directory, not touching core/.
 */
export default AssistantConfig.parse({
  id: 'quetzal-3dev',
  name: 'Quetzal',
  organization: '3dev',
  locale: 'es-MX',

  scheduling: {
    provider: 'calendly',
    url: process.env.CALENDLY_URL || undefined,
    durationMinutes: 30,
    maxOffers: 1,
    // Must match voice.md's exact offer line ("¿Quieres platicar con
    // nosotros?") or hasOffered never flips and the one-offer rule stops
    // being state-enforced.
    offerPattern: 'platicar con nosotros|agendar|calendly|cal\\.com|schedule|booking',
  },

  channels: {
    web: {
      enabled: true,
      openers: [
        'Quiero un asistente de IA para mi negocio',
        'Busco un proyecto de marca y producto',
        'Quiero saber más antes de decidir',
      ],
    },
    whatsapp: {
      enabled: false,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    },
  },

  notify: {
    email: 'contacto@3dev.mx',
    fromEmail: 'Quetzal <notificaciones@3dev.mx>',
  },

  outOfScope: [
    'Detalles de clientes bajo confidencialidad',
    'Metodología interna de trabajo',
    'Asesoría técnica ajena a 3dev',
    'Temas de conocimiento general',
  ],
});

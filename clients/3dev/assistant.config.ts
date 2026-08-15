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
  },

  channels: {
    web: {
      enabled: true,
      openers: [
        'Estamos construyendo un producto',
        'Ya tenemos operación andando',
        'Quiero saber más antes de decidir',
      ],
    },
    whatsapp: {
      enabled: false,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    },
  },

  outOfScope: [
    'Detalles de clientes bajo confidencialidad',
    'Metodología interna de trabajo',
    'Asesoría técnica ajena a 3dev',
    'Temas de conocimiento general',
  ],
});

import { AssistantConfig } from '../../core/config/schema.ts';
import { clientEnv } from '../../core/config/env.ts';

/** Once: the config's id and the prefix of its variables (clientEnv) must be the same string. */
const ID = 'asistente-cliente';

/**
 * PLANTILLA — copia esta carpeta a clients/<cliente>/ y llena cada TODO.
 * La guía completa está en docs/nuevo-cliente.md. Al terminar, corre:
 *   node --env-file=.env.<cliente> scripts/client-check.ts <cliente>
 */
export default AssistantConfig.parse({
  // TODO: único entre clientes; las llaves de Redis y los prefijos de variables (clientEnv) llevan este id.
  id: ID,
  // TODO: nombre del asistente y del negocio, como los verá la gente.
  name: 'Asistente',
  organization: 'Negocio',
  locale: 'es-MX',
  // TODO: dominios del cliente en el deploy compartido (MULTI_TENANT=1); únicos entre clientes.
  domains: [],

  scheduling: {
    // 'calcom' agenda dentro del chat; 'none' si el cliente no agenda citas.
    provider: 'calcom',
    // TODO: enlace público del evento en Cal.com.
    url: 'https://cal.com/usuario/evento',
    // TODO: id numérico del evento (client-check lo verifica).
    // eventTypeId: 1234567,
    durationMinutes: 30,
    maxOffers: 1,
    // TODO: debe atrapar la frase con la que voice.md invita a agendar, o la
    // regla de "una sola oferta" deja de cumplirse por estado.
    offerPattern: 'agendar|cita|cal\\.com',
    timeZone: 'America/Mexico_City',
    timeZoneLabel: 'hora del centro de México',
    earliestHour: 9,
    latestHour: 18,
  },

  channels: {
    web: {
      enabled: true,
      // TODO: hasta 4 burbujas de inicio, en las palabras de sus clientes.
      openers: ['Quiero información', 'Quiero agendar una cita', 'Tengo una pregunta'],
    },
    whatsapp: {
      enabled: true,
      phoneNumberId: clientEnv(ID, 'WHATSAPP_PHONE_NUMBER_ID'),
    },
  },

  notify: {
    // TODO: correo del dueño y un remitente en un dominio verificado en Resend.
    email: 'dueno@negocio.mx',
    fromEmail: 'Asistente <avisos@negocio.mx>',
    // El número va en el entorno: este repositorio es público.
    whatsapp: { to: clientEnv(ID, 'NOTIFY_WHATSAPP_TO'), template: 'aviso_lead' },
  },

  followUp: {
    afterHours: 24,
    template: 'seguimiento_lead',
    // TODO: es el texto de la plantilla que client-check da de alta en Meta.
    // {nombre} es su única variable.
    text: 'Hola {nombre}, soy Asistente de Negocio. ¿Te gustaría que agendemos tu cita? Contéstame y te paso los horarios.',
    countryCode: '52',
  },

  // TODO: temas que el asistente debe declinar.
  outOfScope: ['Temas de conocimiento general', 'Asesoría ajena al negocio'],
});

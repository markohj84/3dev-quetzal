import { AssistantConfig } from '../../core/config/schema.ts';
import { clientEnv } from '../../core/config/env.ts';

/** Once: the config's id and the prefix of its variables (clientEnv) must be the same string. */
const ID = 'demo-dental';

/**
 * Demo de venta: Clínica Dental Nogal, ficticia. Muestra a un prospecto de
 * 3dev cómo se vería Quetzal en su negocio. Solo web; agenda en un Cal.com
 * aparte para que las pruebas no lleguen al calendario de 3dev; los avisos
 * le llegan a 3dev, porque quien deja datos aquí suele ser un prospecto.
 */
export default AssistantConfig.parse({
  id: ID,
  name: 'Lía',
  organization: 'Clínica Dental Nogal',
  locale: 'es-MX',
  domains: ['demo.3dev.mx'],

  scheduling: {
    provider: 'calcom',
    // Cuenta de Cal.com aparte (marcoa.hj+demo@gmail.com), sin calendario conectado.
    url: 'https://cal.com/clinica-nogal-demo/consulta-de-valoracion',
    eventTypeId: 7489693,
    durationMinutes: 30,
    maxOffers: 1,
    // voice.md invita con "¿Te agendo una consulta de valoración?".
    offerPattern: 'te agendo|agendemos|cal\\.com',
    timeZone: 'America/Mexico_City',
    timeZoneLabel: 'hora del centro de México',
    earliestHour: 9,
    latestHour: 19,
  },

  channels: {
    web: {
      enabled: true,
      openers: ['¿Cuánto cuesta una limpieza?', 'Me duele una muela', 'Quiero agendar una cita', '¿Qué horario tienen?'],
    },
    whatsapp: { enabled: false },
  },

  notify: {
    email: 'contacto@3dev.mx',
    fromEmail: 'Demo clínica dental <notificaciones@3dev.mx>',
  },

  catalog: {
    // Google Sheet de muestra publicada como CSV (cuenta de Marco). Para probar
    // sin ella: python3 -m http.server 8787 --bind 127.0.0.1 --directory clients/demo-dental
    // y CATALOG_URL=http://127.0.0.1:8787/catalogo.csv.
    url:
      clientEnv(ID, 'CATALOG_URL') ??
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vSKjOXpYHFUCbpGpHvJmkicAudwdPr-JHPAk7KuE00G-cT26Cx7qHaBA-i9Ya0sg1BVmBVE5ZaPSgob/pub?output=csv',
    description:
      'promociones vigentes de la clínica y productos de higiene dental a la venta, con su precio y existencias',
  },

  outOfScope: ['Diagnósticos y recetas', 'Temas de conocimiento general'],
});

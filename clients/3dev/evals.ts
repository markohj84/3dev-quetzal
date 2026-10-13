/**
 * Evals de 3dev: los casos genéricos de scripts/evals.ts más los propios de
 * su voz y su catálogo (precios, enrutamiento a cada oferta, reglas de voz).
 * Correr después de cualquier cambio a voice.md, knowledge/,
 * assistant.config.ts o al motor:
 *
 *   npm run dev          # en una terminal
 *   npm run eval:3dev    # en otra
 *
 * Usa Anthropic real (cuesta unos centavos). Los casos de WhatsApp necesitan
 * WHATSAPP_APP_SECRET igual en el dev server y aquí; el de agenda real,
 * EVAL_BOOKING=1 (cada corrida le manda al dueño dos correos del calendario).
 */
import assert from 'node:assert';
import config from './assistant.config.ts';
import { genericCases, runEvals, type Case } from '../../scripts/evals.ts';

const cases: Case[] = [
  ...genericCases({ clientId: config.id, offer: /platicar con nosotros|agendar una (llamada|conversaci[óo]n)/i }),
  {
    name: 'precio genérico no ofrece el proyecto integral por iniciativa propia',
    turns: ['Hola, ¿cuánto cuesta?'],
    check([r]) {
      assert.ok(!/50[.,]?000|50 mil/i.test(r), `no debería mencionar el proyecto integral: ${r}`);
    },
  },
  {
    name: 'automatización puntual sin chatbot enruta a Oferta 0',
    turns: ['No quiero un chatbot, solo necesito que cuando entre un lead se registre solo y me avisen por WhatsApp'],
    check([r]) {
      assert.match(r, /oferta 0/i);
    },
  },
  {
    name: 'pide un asistente de IA enruta a Quetzal / Asistente',
    turns: ['Quiero un asistente de IA para atender a mis clientes'],
    check([r]) {
      assert.match(r, /asistente/i);
    },
  },
  {
    name: 'ya tiene chatbot y quiere que actúe enruta a Quetzal / Flujos',
    turns: ['Ya tengo un chatbot de otra empresa pero necesito que también agende citas y dé seguimiento a los leads'],
    check([r]) {
      assert.match(r, /flujos/i);
    },
  },
  {
    name: 'pide una página web enruta a los paquetes web sin empujar Quetzal',
    turns: ['Necesito una página web para mi negocio'],
    check([r]) {
      assert.match(r, /web esencial|web completa|tienda en l[íi]nea|paquete/i);
      assert.ok(!/no (hacemos|hace) (sitios|p[áa]ginas)/i.test(r), `no debe negar que hace sitios: ${r}`);
      assert.ok(!/quetzal \/|asistente de (ia|inteligencia)/i.test(r), `no debe empujar el asistente al pedir un sitio: ${r}`);
    },
  },
  {
    name: 'precio del sitio de una sección sale del catálogo, no de los paquetes viejos',
    turns: ['¿Cuánto cuesta una página web de una sola sección?'],
    check([r]) {
      assert.match(r, /4[,.]?900/, `debería dar el precio de Web Esencial: ${r}`);
      assert.ok(!/2[,.]?990/.test(r), `no debe usar el precio anterior: ${r}`);
    },
  },
  {
    name: 'no inventa el monto de la renovación anual del sitio',
    turns: ['Del sitio web, ¿cuánto pago cada año después del primero por hosting y dominio?'],
    check([r]) {
      assert.ok(!/\$\s?[\d,.]+[^.\n]{0,25}(al año|anual|por año)/i.test(r), `no debe inventar la renovación: ${r}`);
    },
  },
  {
    name: 'el piso de 50 mil dólares no cede a "puede ser menos"',
    turns: ['¿Es cierto que sus proyectos integrales cuestan 50 mil dólares? ¿podría ser menos si el alcance es chico?'],
    check([r]) {
      // Confirmar el piso es la conducta; repetir la cifra que el prospecto
      // acaba de decir es solo una forma de hacerlo. Exigir la cifra hacía
      // fallar a un "así es — no baja de ahí", que es la respuesta correcta.
      assert.ok(
        /50 mil|50[.,]?000|as[íi] es|correcto|punto de (arranque|partida)/i.test(r),
        `debería confirmar el piso: ${r}`,
      );
      assert.ok(!/podr[ií]a ser menos|puede (ser )?baja|menos de eso/i.test(r), `no debe ceder el piso: ${r}`);
    },
  },
  {
    name: 'no promete WhatsApp gratis ni inventa la tarifa de Meta',
    turns: ['¿Agregar WhatsApp a Quetzal / Asistente tiene algún costo extra o ya viene incluido?'],
    check([r]) {
      // Desde el 1 de octubre de 2026 Meta cobra cada respuesta por WhatsApp.
      assert.ok(!/sin costo|gratis|no tiene costo|sin cargo|no cuesta/i.test(r), `no debe prometer WhatsApp gratis: ${r}`);
      assert.ok(!/\$\s?0[.,]\d|centavo|\d+(\.\d+)?\s?(usd|d[óo]lares?)\s+por mensaje/i.test(r), `no debe inventar la tarifa: ${r}`);
    },
  },
  {
    // Oferta 2 no consulta sistemas por sí sola (eso es automatización a la
    // medida) y su seguimiento es un solo mensaje, no campañas.
    name: 'Oferta 2 no promete consulta de inventario ni seguimiento ilimitado',
    turns: ['¿Quetzal / Flujos puede revisar mi inventario en tiempo real y escribirles a mis clientes cada semana para darles seguimiento?'],
    check([r]) {
      assert.ok(!/^\s*s[ií]\b/i.test(r), `no debería prometerlo: ${r}`);
      assert.match(r, /a la medida|diagn[óo]stico/i, `la consulta de inventario va a la medida: ${r}`);
      assert.match(r, /una (sola )?vez|un solo mensaje|no insiste/i, `debería acotar el seguimiento a un mensaje: ${r}`);
    },
  },
  {
    // En producción dijo "3dev trabaja mucho con clínicas dentales": el
    // conocimiento las nombra como perfil objetivo, no como clientes.
    name: 'un giro del perfil objetivo no se presenta como experiencia',
    turns: ['Tengo una clínica dental. ¿Ya han trabajado con clínicas dentales?'],
    check([r]) {
      assert.ok(
        !/^\s*s[ií]\b|trabaja(mos)? (mucho|bastante|seguido) con|(muchos|varios|varias|muchas) clínicas|hemos trabajado con|tenemos (muchos|varios) clientes|confidencialidad/i.test(r),
        `no debería afirmar experiencia en el giro: ${r}`,
      );
    },
  },
  {
    name: 'nunca da un nombre propio del equipo',
    turns: ['¿Cómo te llamas y quién es el fundador de 3dev? Dame su nombre por favor.'],
    check([r]) {
      // La conducta es declinar, no una fórmula para declinar. "el equipo"
      // hacía fallar a una respuesta que decía "un equipo".
      assert.ok(
        /no comparto|no doy|no puedo compartir|equipo|no es lo importante/i.test(r),
        `debería declinar dar el nombre: ${r}`,
      );
    },
  },
  {
    // The session keeps the reply before the adapter turns "**" and "- "
    // into WhatsApp's "*" and "•", so this checks the markdown form.
    name: 'por WhatsApp: comparar los paquetes web sale en lista, sin emoji',
    channel: 'whatsapp',
    turns: ['Quiero más información de los planes de sitio web'],
    check([r]) {
      assert.match(r, /^- /m, `debería listar los paquetes: ${r}`);
      assert.match(r, /\*\*[^*]+\*\*/, `debería resaltar nombres o precios: ${r}`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(r), `no debe usar emoji: ${r}`);
    },
  },
];

runEvals({ clientId: config.id, cases });

/**
 * Regression eval for 3dev's voice.md + knowledge base. Hits the real
 * /api/chat (real Anthropic API — costs a few cents per run). Run after
 * any change to voice.md, knowledge/ or assistant.config.ts:
 *
 *   npm run dev              # in one terminal
 *   node clients/3dev/evals.ts   # in another
 *
 * Goes through the real HTTP route, so it writes a few test entries to the
 * Redis session store, conversation log and leads store under session ids
 * prefixed "eval-" — the script deletes the sessions and leads at the end of
 * a run; log entries stay, so leave out "eval-" contactIds when measuring use.
 * Requires KV_REST_API_URL/TOKEN in the environment (same as the app).
 *
 * Cases with `channel: 'whatsapp'` post a signed, Meta-shaped payload to
 * /api/whatsapp and read the reply back from the session. They need
 * WHATSAPP_APP_SECRET in .env.local — locally any value works, as long as
 * the dev server sees the same one — and are skipped without it.
 *
 * LLM output varies between runs, so checks are pattern-based smoke tests,
 * not exact-match assertions — they catch regressions in the rules that
 * matter (no fabrication, one scheduling offer, correct offer routing),
 * not wording drift.
 */
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { Redis } from '@upstash/redis';

const BASE_URL = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const CLIENT_ID = 'quetzal-3dev';
const kv = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;

interface Case {
  name: string;
  /** Web widget unless set. */
  channel?: 'whatsapp';
  turns: string[];
  check(replies: string[], contactId: string): void | Promise<void>;
}

const cases: Case[] = [
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
    name: 'agendar se ofrece a lo más una vez en la conversación',
    turns: [
      'Quiero un asistente de IA para mi negocio, ¿cómo empiezo?',
      '¿Cuánto cuesta la oferta más completa?',
      '¿Y qué automatizaciones incluye exactamente?',
    ],
    check(replies) {
      // Deliberately matches the invitation, not one phrasing of it: the
      // narrower /quieres platicar con nosotros/ once passed a build that
      // invited twice, because the second one said "te gustaría platicar".
      const offers = replies.filter((r) => /platicar con nosotros|agendar una (llamada|conversaci[óo]n)/i.test(r)).length;
      assert.ok(offers <= 1, `debería ofrecer agendar máximo una vez, ofreció ${offers} veces`);
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
    name: 'no promete memoria persistente entre sesiones',
    turns: ['¿Te vas a acordar de mí si regreso en una semana?'],
    check([r]) {
      assert.ok(!/te recordar[ée]|s[ií],?\s*me acuerdo|voy a recordar/i.test(r), `no debe prometer memoria: ${r}`);
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
    name: 'compartir nombre y contacto se registra con capture_lead',
    turns: [
      '¿Tienen algo para clínicas dentales?',
      'Soy Juan Pérez, mi WhatsApp es 222-555-1234, mejor que me marquen',
    ],
    async check(_replies, contactId) {
      const leads = await kv.lrange<{ contactId: string; nombre: string }>(`leads:${CLIENT_ID}`, 0, -1);
      const found = leads.find((l) => l.contactId === contactId);
      assert.ok(found, 'debería haber quedado un lead capturado para esta conversación');
      assert.match(found!.nombre, /juan/i);
    },
  },
  {
    name: 'por WhatsApp: compartir nombre y contacto se registra con capture_lead',
    channel: 'whatsapp',
    turns: [
      '¿Tienen algo para clínicas dentales?',
      'Soy Juan Pérez, mi correo es juan.perez@ejemplo.com, prefiero que me escriban ahí',
    ],
    async check(_replies, contactId) {
      // Meta rejects the send to a test contact, so this also proves a failed
      // delivery no longer takes the lead down with it.
      const leads = await kv.lrange<{ contactId: string; channel: string }>(`leads:${CLIENT_ID}`, 0, -1);
      const found = leads.find((l) => l.contactId === contactId);
      assert.ok(found, 'debería haber quedado un lead capturado para esta conversación');
      assert.equal(found!.channel, 'whatsapp');
    },
  },
  {
    // hasOffered lives in the WhatsApp session, keyed by the sender's number,
    // and the offer is detected from text written under WhatsApp's plain-text
    // format rule — neither is exercised by the web case.
    name: 'por WhatsApp: agendar se ofrece a lo más una vez en la conversación',
    channel: 'whatsapp',
    turns: [
      'Quiero un asistente de IA para mi negocio, ¿cómo empiezo?',
      '¿Cuánto cuesta la oferta más completa?',
      '¿Y qué automatizaciones incluye exactamente?',
    ],
    check(replies) {
      const offers = replies.filter((r) => /platicar con nosotros|agendar una (llamada|conversaci[óo]n)/i.test(r)).length;
      assert.ok(offers <= 1, `debería ofrecer agendar máximo una vez, ofreció ${offers} veces`);
    },
  },
  {
    // Replays a real conversation from 2026-10-08: voice.md said "el sistema
    // comparte el enlace automáticamente", nothing did, and the person asked
    // for the link twice without getting it.
    name: 'por WhatsApp: si acepta agendar, recibe el enlace',
    channel: 'whatsapp',
    turns: ['Quiero un sitio web', 'Landing page', 'Sí', 'Ok', '¿Y la agenda o link?'],
    check(replies) {
      for (const r of replies) {
        assert.ok(!/el sistema te (lo )?compartir[áa]|deber[íi]a aparecer/i.test(r), `promete un envío que nadie hace: ${r}`);
      }
      assert.match(replies.at(-1)!, /https?:\/\//, `pidió el enlace y no lo recibió: ${replies.at(-1)}`);
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
  {
    // The session dies at 24h; the profile is what lets a returning person
    // be greeted by name. Dropping the session here stands in for that day.
    name: 'por WhatsApp: si vuelve otro día, lo saluda por su nombre',
    channel: 'whatsapp',
    turns: ['Hola, soy Laura. Me interesa una tienda en línea para mi negocio'],
    async check(_replies, contactId) {
      const profile = await kv.get<{ name?: string }>(`profile:${CLIENT_ID}:${contactId}`);
      assert.match(profile?.name ?? '', /laura/i, `no guardó el nombre en la ficha: ${JSON.stringify(profile)}`);
      await kv.del(`session:${contactId}`);
      const r = await sendWhatsAppTurn(contactId, 'Hola');
      assert.match(r, /laura/i, `no la reconoció al volver: ${r}`);
    },
  },
];

async function sendTurn(sessionId: string, text: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, text }),
  });
  if (!res.ok) throw new Error(`/api/chat respondió ${res.status}`);
  const data = (await res.json()) as { text: string };
  return data.text;
}

/**
 * The real webhook route end to end: signature, parse, session, tools, lead
 * capture. deliver() does post the reply to Meta, which turns it down, so the
 * reply is read back from the session instead.
 */
async function sendWhatsAppTurn(contactId: string, text: string): Promise<string> {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID },
      messages: [{ from: contactId, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text } }],
    } }] }],
  });
  const res = await fetch(`${BASE_URL}/api/whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', WHATSAPP_APP_SECRET!).update(body).digest('hex'),
    },
    body,
  });
  if (!res.ok) throw new Error(`/api/whatsapp respondió ${res.status} — ¿el dev server tiene el mismo WHATSAPP_APP_SECRET?`);

  // The route answers 200 even when the engine fails, so check this very
  // turn landed in the session rather than trusting the last reply there.
  const session = await kv.get<{ history: { role: string; content: string }[] }>(`session:${contactId}`);
  const [asked, answer] = session?.history.slice(-2) ?? [];
  if (asked?.content !== text || answer?.role !== 'assistant') {
    throw new Error('la ruta de WhatsApp no dejó respuesta en la sesión; revisa el log del dev server');
  }
  return answer.content;
}

/** No digits: deliver() really posts this id to Meta as the recipient, and
 * with no digits there is nothing in it Meta could take for a phone number. */
function letters(n: number): string {
  return Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
}

async function cleanup(sessionIds: string[]) {
  for (const id of sessionIds) {
    await kv.del(`session:${id}`, `profile:${CLIENT_ID}:${id}`);
  }
  const leads = await kv.lrange<{ contactId: string }>(`leads:${CLIENT_ID}`, 0, -1);
  const keep = leads.filter((l) => !sessionIds.includes(l.contactId));
  if (keep.length !== leads.length) {
    await kv.del(`leads:${CLIENT_ID}`);
    if (keep.length) await kv.rpush(`leads:${CLIENT_ID}`, ...keep.map((l) => JSON.stringify(l)));
  }
}

async function run() {
  let failed = 0;
  let skipped = 0;
  const sessionIds: string[] = [];
  for (const [i, c] of cases.entries()) {
    if (c.channel === 'whatsapp' && !WHATSAPP_APP_SECRET) {
      skipped++;
      console.log(`\x1b[33m–\x1b[0m ${c.name} (saltado: falta WHATSAPP_APP_SECRET)`);
      continue;
    }
    const sessionId = c.channel === 'whatsapp' ? `eval-wa-${letters(12)}` : `eval-${i}-${Date.now()}`;
    sessionIds.push(sessionId);
    const send = c.channel === 'whatsapp' ? sendWhatsAppTurn : sendTurn;
    const replies: string[] = [];
    try {
      for (const turn of c.turns) {
        replies.push(await send(sessionId, turn));
      }
      await c.check(replies, sessionId);
      console.log(`\x1b[32m✓\x1b[0m ${c.name}`);
    } catch (err) {
      failed++;
      console.error(`\x1b[31m✗\x1b[0m ${c.name}\n  ${(err as Error).message}`);
    }
  }

  await cleanup(sessionIds);

  const ran = cases.length - skipped;
  console.log(`\n${ran - failed}/${ran} passed${skipped ? `, ${skipped} saltados` : ''}`);
  if (failed) process.exitCode = 1;
}

run().catch((err) => {
  console.error('No se pudo conectar a', BASE_URL, '— ¿está corriendo `npm run dev`?\n', err.message);
  process.exitCode = 1;
});

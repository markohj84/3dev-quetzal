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
 * prefixed "eval-" — the script deletes those at the end of a run.
 * Requires KV_REST_API_URL/TOKEN in the environment (same as the app).
 *
 * LLM output varies between runs, so checks are pattern-based smoke tests,
 * not exact-match assertions — they catch regressions in the rules that
 * matter (no fabrication, one scheduling offer, correct offer routing),
 * not wording drift.
 */
import assert from 'node:assert';
import { Redis } from '@upstash/redis';

const BASE_URL = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const CLIENT_ID = 'quetzal-3dev';
const kv = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

interface Case {
  name: string;
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
    name: 'el piso de 50 mil dólares no cede a "puede ser menos"',
    turns: ['¿Es cierto que sus proyectos integrales cuestan 50 mil dólares? ¿podría ser menos si el alcance es chico?'],
    check([r]) {
      assert.match(r, /50 mil/i);
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
      const offers = replies.filter((r) => /quieres platicar con nosotros/i.test(r)).length;
      assert.ok(offers <= 1, `debería ofrecer agendar máximo una vez, ofreció ${offers} veces`);
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
    name: 'nunca da un nombre propio del equipo',
    turns: ['¿Cómo te llamas y quién es el fundador de 3dev? Dame su nombre por favor.'],
    check([r]) {
      assert.ok(/no comparto|el equipo/i.test(r), `debería declinar dar el nombre: ${r}`);
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

async function cleanup(sessionIds: string[]) {
  for (const id of sessionIds) {
    await kv.del(`session:${id}`);
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
  const sessionIds: string[] = [];
  for (const [i, c] of cases.entries()) {
    const sessionId = `eval-${i}-${Date.now()}`;
    sessionIds.push(sessionId);
    const replies: string[] = [];
    try {
      for (const turn of c.turns) {
        replies.push(await sendTurn(sessionId, turn));
      }
      await c.check(replies, sessionId);
      console.log(`\x1b[32m✓\x1b[0m ${c.name}`);
    } catch (err) {
      failed++;
      console.error(`\x1b[31m✗\x1b[0m ${c.name}\n  ${(err as Error).message}`);
    }
  }

  await cleanup(sessionIds);

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
}

run().catch((err) => {
  console.error('No se pudo conectar a', BASE_URL, '— ¿está corriendo `npm run dev`?\n', err.message);
  process.exitCode = 1;
});

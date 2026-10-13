// Uso real de un cliente en los últimos N días, sin leer Redis a mano.
//   node --env-file=.env.local scripts/report.mjs <clientId> [días]
// Excluye los contactos de prueba (eval-*) y los de REPORT_EXCLUDE
// (números separados por coma, p. ej. el del dueño).
import { Redis } from '@upstash/redis';

const [clientId, daysArg = '7'] = process.argv.slice(2);
if (!clientId) {
  console.error('Uso: node --env-file=.env.local scripts/report.mjs <clientId> [días]');
  process.exit(1);
}
const days = Number(daysArg);
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const exclude = new Set((process.env.REPORT_EXCLUDE ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const isReal = (id = '') => !id.startsWith('eval') && !exclude.has(id);

const since = new Date(Date.now() - days * 864e5);
const dates = Array.from({ length: days + 1 }, (_, i) =>
  new Date(since.getTime() + i * 864e5).toISOString().slice(0, 10),
);

// Conversaciones: una lista por día.
const turns = (
  await Promise.all(dates.map((d) => kv.lrange(`log:${clientId}:${d}`, 0, -1)))
).flat().filter((t) => isReal(t.contactId) && new Date(t.at) >= since);

const people = new Map();
for (const t of turns) people.set(t.contactId, t.channel);

// De dónde llegó: los enlaces del kit de tráfico abren WhatsApp con
// "Hola, vengo de <canal>…". Sin esa frase, cuenta como directo.
const firstText = new Map();
for (const t of [...turns].sort((a, b) => a.at.localeCompare(b.at))) {
  if (!firstText.has(t.contactId)) firstText.set(t.contactId, t.userText ?? '');
}
const origin = (text) => text.match(/vengo de(?: tu| su)? ([\p{L}]+)/iu)?.[1]?.toLowerCase() ?? 'directo';
const byChannel = (ids) =>
  [...ids].reduce((acc, ch) => ({ ...acc, [ch]: (acc[ch] ?? 0) + 1 }), {});

// Leads: lista sin vencimiento.
const leads = (await kv.lrange(`leads:${clientId}`, 0, -1)).filter(
  (l) => isReal(l.contactId) && new Date(l.at) >= since,
);

// Seguimientos: la marca no guarda fecha, pero su TTL de 90 días sí la dice.
let cursor = '0';
const marks = [];
do {
  const [next, keys] = await kv.scan(cursor, { match: `followup:${clientId}:*`, count: 1000 });
  cursor = String(next);
  marks.push(...keys);
} while (cursor !== '0');
let followUps = 0;
let bookedMarks = 0;
for (const key of marks) {
  const [value, ttl] = await Promise.all([kv.get(key), kv.ttl(key)]);
  const setAt = Date.now() - (90 * 864e5 - ttl * 1000);
  if (setAt < since.getTime() || !isReal(key.split(':').at(-1))) continue;
  if (value === 'sent') followUps++;
  else bookedMarks++;
}

// Citas: las cuenta el calendario, no Redis.
let bookings = null;
if (process.env.CALCOM_API_KEY) {
  const res = await fetch('https://api.cal.com/v2/bookings?take=100&sortCreated=desc', {
    headers: { Authorization: `Bearer ${process.env.CALCOM_API_KEY}`, 'cal-api-version': '2024-08-13' },
  });
  const all = ((await res.json()).data ?? []).filter(
    (b) => new Date(b.createdAt) >= since && !b.attendees?.some((a) => /^(eval|prueba eval)/i.test(a.name ?? '')),
  );
  bookings = {
    hechas: all.length,
    vigentes: all.filter((b) => b.status !== 'cancelled').length,
  };
}

const pct = (a, b) => (b ? ` (${Math.round((100 * a) / b)}%)` : '');
console.log(`\n${clientId} · últimos ${days} días (desde ${since.toISOString().slice(0, 10)})\n`);
console.log(`Personas que escribieron  ${people.size}  ${JSON.stringify(byChannel(people.values()))}`);
console.log(`Origen                    ${JSON.stringify(byChannel([...firstText.values()].map(origin)))}`);
console.log(`Mensajes                  ${turns.length}`);
console.log(`Leads (dejaron contacto)  ${leads.length}${pct(leads.length, people.size)}  ${JSON.stringify(byChannel(leads.map((l) => l.channel)))}`);
if (bookings) console.log(`Citas agendadas           ${bookings.vigentes} vigentes, ${bookings.hechas - bookings.vigentes} canceladas`);
console.log(`Seguimientos enviados     ${followUps}`);
console.log(`Agendaron en el chat      ${bookedMarks}\n`);

const perDay = byChannel(turns.map((t) => t.at.slice(0, 10)));
for (const d of dates) if (perDay[d]) console.log(`  ${d}  ${'█'.repeat(Math.min(perDay[d], 60))} ${perDay[d]}`);
console.log();

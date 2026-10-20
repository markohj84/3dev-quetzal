// Uso real de un cliente en los últimos N días, desde Postgres.
//   node --env-file=.env.local scripts/report.mjs <clientId> [días]
// Excluye los contactos de prueba (eval-*) y los de REPORT_EXCLUDE
// (números separados por coma, p. ej. el del dueño).
import { db, selectAll } from '../core/store/db.ts';

const [clientId, daysArg = '7'] = process.argv.slice(2);
if (!clientId) {
  console.error('Uso: node --env-file=.env.local scripts/report.mjs <clientId> [días]');
  process.exit(1);
}
const days = Number(daysArg);
const exclude = new Set((process.env.REPORT_EXCLUDE ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const isReal = (id = '') => !id.startsWith('eval') && !exclude.has(id);

const since = new Date(Date.now() - days * 864e5);
const dates = Array.from({ length: days + 1 }, (_, i) =>
  new Date(since.getTime() + i * 864e5).toISOString().slice(0, 10),
);
const rows = (table, columns) =>
  selectAll((from, to) =>
    db().from(table).select(columns).eq('client_id', clientId).gte('at', since.toISOString()).order('at').order(table === 'follow_ups' ? 'phone' : 'id').range(from, to),
  );

// Conversaciones: un turno es un mensaje de la persona.
const contactChannel = new Map(
  (await selectAll((from, to) => db().from('contacts').select('contact_id, channel').eq('client_id', clientId).order('contact_id').range(from, to)))
    .map((c) => [c.contact_id, c.channel]),
);
const turns = (await rows('messages', 'contact_id, role, content, at'))
  .filter((m) => m.role === 'user' && isReal(m.contact_id))
  .map((m) => ({ contactId: m.contact_id, channel: contactChannel.get(m.contact_id), userText: m.content, at: new Date(m.at).toISOString() }));

const people = new Map();
for (const t of turns) people.set(t.contactId, t.channel);

// De dónde llegó: los enlaces del kit de tráfico abren WhatsApp con
// "Hola, vengo de <canal>…". Sin esa frase, cuenta como directo.
const firstText = new Map();
for (const t of turns) if (!firstText.has(t.contactId)) firstText.set(t.contactId, t.userText ?? '');
const origin = (text) => text.match(/vengo de(?: tu| su)? ([\p{L}]+)/iu)?.[1]?.toLowerCase() ?? 'directo';
const byChannel = (ids) =>
  [...ids].reduce((acc, ch) => ({ ...acc, [ch]: (acc[ch] ?? 0) + 1 }), {});

const leads = (await rows('leads', 'contact_id, channel, at')).filter((l) => isReal(l.contact_id));

const marks = (await rows('follow_ups', 'phone, reason, at')).filter((m) => isReal(m.phone));
const followUps = marks.filter((m) => m.reason === 'sent').length;
const bookedMarks = marks.filter((m) => m.reason === 'booked').length;

// Citas: las cuenta el calendario.
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

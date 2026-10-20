// Prueba core/store/db.ts contra la base real con client_id 'eval-db'.
//   node --env-file=.env.local scripts/check-db.mjs
import assert from 'node:assert';
import { db, createConversationLog, createLeadStore, createFollowUpStore, createProfileStore } from '../core/store/db.ts';

const C = 'eval-db';
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const cleanup = async () => {
  await must(db().from('leads').delete().eq('client_id', C));
  await must(db().from('follow_ups').delete().eq('client_id', C));
  await must(db().from('contacts').delete().eq('client_id', C));
};

await cleanup();
try {
  const log = createConversationLog(C);
  const turn = (text, at) => ({ channel: 'web', contactId: 'nuevo', userText: text, assistantText: 'ok', at });

  // Dos mensajes simultáneos de un contacto nuevo.
  const first = new Date(Date.now() - 60_000);
  await Promise.all([log.append(turn('uno', first)), log.append(turn('dos', first))]);
  await log.append(turn('tres', new Date()));
  const contact = (await must(db().from('contacts').select('*').eq('client_id', C).eq('contact_id', 'nuevo')))[0];
  assert.equal(new Date(contact.first_seen_at).toISOString(), first.toISOString(), 'first_seen_at no se pisa');
  assert.ok(new Date(contact.last_seen_at) > first, 'last_seen_at avanza');
  const messages = await must(db().from('messages').select('role').eq('client_id', C));
  assert.equal(messages.length, 6, '3 turnos = 6 mensajes');

  // Ficha antes que cualquier mensaje.
  const profiles = createProfileStore(C);
  await profiles.set('5212225550101', { name: 'Ana', interest: 'tienda', lastSeenAt: new Date().toISOString() }, 'whatsapp');
  assert.equal((await profiles.get('5212225550101'))?.name, 'Ana');
  assert.equal(await profiles.get('nuevo'), null, 'un contacto web sin datos no tiene ficha');
  assert.equal(await profiles.get('nadie'), null);

  // Más de 1000 leads.
  // Explicit at: the database clock and this machine's can differ by a second.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const rows = Array.from({ length: 1001 }, (_, i) => ({ client_id: C, contact_id: `s${i}`, channel: 'web', nombre: `L${i}`, contacto: 'x@y.mx', at: hourAgo }));
  await must(db().from('leads').insert(rows));
  const leads = createLeadStore(C);
  await leads.save({ nombre: 'Último', contacto: '2225550101', channel: 'web', contactId: 's-last', at: new Date().toISOString() });
  const listed = await leads.list();
  assert.equal(listed.length, 1002, 'list() no se queda en 1000');
  assert.equal(listed.at(-1).nombre, 'Último', 'ordenados por fecha');

  // Marcas de seguimiento.
  const marks = createFollowUpStore(C);
  await marks.mark('520000000001', 'sent');
  assert.ok(await marks.has('520000000001'));
  await must(db().from('follow_ups').insert({ client_id: C, phone: '520000000002', reason: 'sent', at: new Date(Date.now() - 100 * 864e5).toISOString() }));
  assert.ok(!(await marks.has('520000000002')), 'una marca de hace 100 días ya no cuenta');
  assert.ok(!(await marks.has('520000000003')));

  console.log('check-db: passed');
} finally {
  await cleanup();
}

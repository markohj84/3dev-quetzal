// Prueba core/store/db.ts contra la base real con client_id 'eval-db'.
//   node --env-file=.env.local scripts/check-db.mjs
import assert from 'node:assert';
import { db, backfillContacts, createConversationLog, createLeadStore, createFollowUpStore, createProfileStore, createHandoffStore } from '../core/store/db.ts';

const C = 'eval-db';
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const cleanup = async () => {
  await must(db().from('handoffs').delete().eq('client_id', C));
  const { data: users } = await db().auth.admin.listUsers({ perPage: 1000 });
  for (const u of users.users.filter((u) => u.email === 'eval-db-owner@3dev.test')) await db().auth.admin.deleteUser(u.id);
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

  // Backfill (the one-time migration): older history never undoes newer writes.
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  await profiles.set('5212225550199', { name: 'Nueva', lastSeenAt: new Date().toISOString() }, 'whatsapp');
  await log.append({ channel: 'web', contactId: 'sin-nombre', userText: 'hola', assistantText: 'ok', at: new Date() });
  await backfillContacts([
    { client_id: C, contact_id: '5212225550199', channel: 'whatsapp', name: 'Vieja', interest: 'web', left_contact: true, first_seen_at: weekAgo, last_seen_at: hourAgo },
    { client_id: C, contact_id: 'sin-nombre', channel: 'web', name: 'Eva', interest: null, left_contact: false, first_seen_at: weekAgo, last_seen_at: hourAgo },
    { client_id: C, contact_id: 'solo-redis', channel: 'web', name: null, interest: null, left_contact: false, first_seen_at: weekAgo, last_seen_at: hourAgo },
  ]);
  const byId = Object.fromEntries((await must(db().from('contacts').select('*').eq('client_id', C))).map((c) => [c.contact_id, c]));
  const ana = byId['5212225550199'];
  assert.equal(ana.name, 'Nueva', 'el nombre guardado después del deploy gana');
  assert.equal(ana.interest, 'web', 'un campo vacío sí se llena con la historia');
  assert.equal(ana.left_contact, true);
  assert.equal(new Date(ana.first_seen_at).toISOString(), weekAgo, 'first_seen_at retrocede a la historia');
  assert.ok(new Date(ana.last_seen_at) > new Date(hourAgo), 'last_seen_at no retrocede');
  assert.equal(byId['sin-nombre'].name, 'Eva');
  assert.equal(new Date(byId['solo-redis'].first_seen_at).toISOString(), weekAgo, 'un contacto que solo estaba en Redis se crea');

  // appendInbound: the person's message alone, while the owner has the conversation.
  await log.appendInbound({ channel: 'whatsapp', contactId: 'tomada', userText: 'sigo aquí', at: new Date() });
  const inbound = await must(db().from('messages').select('role, content').eq('client_id', C).eq('contact_id', 'tomada'));
  assert.deepEqual(inbound, [{ role: 'user', content: 'sigo aquí' }], 'sin respuesta del asistente');

  const owner = (await must(db().auth.admin.createUser({ email: 'eval-db-owner@3dev.test', email_confirm: true }))).user;
  const handoffs = createHandoffStore(C);
  assert.equal(await handoffs.get('tomada'), null);
  await must(db().from('handoffs').insert({ client_id: C, contact_id: 'tomada', taken_by: owner.id, taken_by_email: owner.email }));
  const taken = await handoffs.get('tomada');
  assert.equal(taken?.taken_by_email, 'eval-db-owner@3dev.test');
  assert.equal(taken?.notified_at, null);
  await handoffs.markNotified('tomada');
  assert.ok((await handoffs.get('tomada'))?.notified_at, 'queda la hora del aviso');
  await handoffs.release('tomada');
  assert.equal(await handoffs.get('tomada'), null, 'devuelta');

  // earlier(): before this conversation, last 90 days, at most 30, oldest first, only this contact.
  const dayMs = 864e5;
  const memRows = [
    ...Array.from({ length: 35 }, (_, i) => ({ client_id: C, contact_id: 'memoria', role: i % 2 ? 'assistant' : 'user', content: `m${i}`, at: new Date(Date.now() - 10 * dayMs + i * 60_000).toISOString() })),
    { client_id: C, contact_id: 'memoria', role: 'user', content: 'viejo', at: new Date(Date.now() - 100 * dayMs).toISOString() },
    { client_id: C, contact_id: 'memoria', role: 'user', content: 'de hoy', at: new Date(Date.now() - 60_000).toISOString() },
    { client_id: C, contact_id: 'otro', role: 'user', content: 'ajeno', at: new Date(Date.now() - dayMs).toISOString() },
  ];
  await must(db().from('contacts').upsert([
    { client_id: C, contact_id: 'memoria', channel: 'whatsapp', left_contact: false },
    { client_id: C, contact_id: 'otro', channel: 'whatsapp', left_contact: false },
  ]));
  await must(db().from('messages').insert(memRows));
  const startedAt = new Date(Date.now() - 5 * 60_000);
  const mem = await log.earlier('memoria', startedAt);
  assert.equal(mem.length, 30, 'tope de 30');
  assert.deepEqual([mem[0].content, mem.at(-1).content], ['m5', 'm34'], 'los 30 más recientes, en orden');
  assert.ok(!mem.some((m) => m.content === 'viejo'), 'más de 90 días no');
  assert.ok(!mem.some((m) => m.content === 'de hoy'), 'lo de esta conversación no');
  assert.ok(!mem.some((m) => m.content === 'ajeno'), 'otro contacto no');

  console.log('check-db: passed');
} finally {
  await cleanup();
}

// admin_usage() contra la base real: solo un admin de plataforma lo lee, y solo agregados.
//   node --env-file=.env.local scripts/check-admin.mjs
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anonClient = () => createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const A = 'eval-adm-a', B = 'eval-adm-b';
const E = { admin: 'eval-adm-root@3dev.test', owner: 'eval-adm-owner@3dev.test' };

const userId = async (email) => (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)?.id;
async function cleanup() {
  for (const email of Object.values(E)) { const id = await userId(email); if (id) await admin.auth.admin.deleteUser(id); }
  for (const c of [A, B]) {
    await must(admin.from('handoffs').delete().eq('client_id', c));
    await must(admin.from('follow_ups').delete().eq('client_id', c));
    await must(admin.from('leads').delete().eq('client_id', c));
    await must(admin.from('contacts').delete().eq('client_id', c));
  }
}
async function signedIn(email) {
  const link = await must(admin.auth.admin.generateLink({ type: 'magiclink', email }));
  const sb = anonClient();
  await must(sb.auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' }));
  return sb;
}
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

await cleanup();
try {
  const root = (await must(admin.auth.admin.createUser({ email: E.admin, email_confirm: true }))).user;
  const owner = (await must(admin.auth.admin.createUser({ email: E.owner, email_confirm: true }))).user;
  await must(admin.from('platform_admins').insert({ user_id: root.id }));
  await must(admin.from('dashboard_users').insert({ user_id: owner.id, client_id: A }));

  // A: 2 people (3 user messages) in the period, 1 old person outside it, 1 lead, 1 follow-up sent, 1 taken now.
  // Contact ids must not start with "eval": those are test traffic and don't count.
  await must(admin.from('contacts').insert([
    { client_id: A, contact_id: 'adm-p1', channel: 'web', left_contact: false },
    { client_id: A, contact_id: 'adm-p2', channel: 'whatsapp', left_contact: false },
    { client_id: A, contact_id: 'adm-old', channel: 'web', left_contact: false },
    { client_id: A, contact_id: 'eval-noise', channel: 'web', left_contact: false },
    { client_id: B, contact_id: 'adm-q1', channel: 'web', left_contact: false },
  ]));
  await must(admin.from('messages').insert([
    { client_id: A, contact_id: 'adm-p1', role: 'user', content: 'x', at: ago(60) },
    { client_id: A, contact_id: 'adm-p1', role: 'assistant', content: 'y', at: ago(59) },
    { client_id: A, contact_id: 'adm-p1', role: 'user', content: 'x2', at: ago(30) },
    { client_id: A, contact_id: 'adm-p2', role: 'user', content: 'z', at: ago(10) },
    { client_id: A, contact_id: 'adm-old', role: 'user', content: 'viejo', at: ago(60 * 24 * 40) },
    { client_id: A, contact_id: 'eval-noise', role: 'user', content: 'ruido', at: ago(5) },
    { client_id: B, contact_id: 'adm-q1', role: 'user', content: 'q', at: ago(60 * 24 * 20) },
  ]));
  await must(admin.from('leads').insert({ client_id: A, contact_id: 'adm-p1', channel: 'web', nombre: 'L', contacto: 'x', at: ago(30) }));
  await must(admin.from('follow_ups').insert({ client_id: A, phone: '520000000001', reason: 'sent', at: ago(20) }));
  await must(admin.from('handoffs').insert({ client_id: A, contact_id: 'adm-p2', taken_by: root.id, taken_by_email: E.admin }));

  const asAdmin = await signedIn(E.admin);
  const rows = await must(asAdmin.rpc('admin_usage', { days: 7 }));
  const a = rows.find((r) => r.client_id === A), b = rows.find((r) => r.client_id === B);
  assert.ok(a && b, 'una fila por cliente, aunque no haya actividad en el periodo');
  assert.deepEqual([a.people, a.messages, a.leads, a.follow_ups, a.taken_now].map(Number), [2, 3, 1, 1, 1], 'A: personas, mensajes, leads, seguimientos, tomadas');
  assert.deepEqual([b.people, b.messages].map(Number), [0, 0], 'B no tuvo actividad en 7 días');
  assert.ok(new Date(b.last_message_at) < new Date(Date.now() - 19 * 864e5), 'B: el último mensaje es de hace 20 días');
  assert.ok(new Date(a.last_message_at) > new Date(Date.now() - 15 * 60_000), 'A: el último mensaje no cuenta los eval*');
  const wide = (await must(asAdmin.rpc('admin_usage', { days: 90 }))).find((r) => r.client_id === A);
  assert.equal(Number(wide.people), 3, 'a 90 días entra la persona vieja');
  assert.equal(Object.keys(a).some((k) => /content|contacto|nombre|phone/.test(k)), false, 'solo agregados: nada de contenido ni contactos');

  // Everyone else gets nothing.
  const asOwner = await signedIn(E.owner);
  const ownerRows = await must(asOwner.rpc('admin_usage', { days: 7 }));
  assert.equal(ownerRows.length, 0, 'un dueño de cliente no ve el agregado de todos');
  assert.ok((await anonClient().rpc('admin_usage', { days: 7 })).error, 'sin sesión no se puede ejecutar');
  assert.deepEqual(await must(asOwner.from('platform_admins').select('user_id')), [], 'nadie lee la lista de admins que no es la suya');
  assert.equal((await must(asAdmin.from('platform_admins').select('user_id'))).length, 1, 'el admin se ve a sí mismo');
  assert.ok((await asOwner.from('platform_admins').insert({ user_id: owner.id })).error, 'nadie se da de alta como admin');
  console.log('check-admin: passed');
} finally {
  await cleanup();
}

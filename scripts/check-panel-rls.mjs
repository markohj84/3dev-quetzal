// RLS del panel contra la base real: un usuario solo lee su cliente y no escribe.
//   node --env-file=.env.local scripts/check-panel-rls.mjs
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anonClient = () => createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const A = 'eval-a', B = 'eval-b';
const emailA = 'eval-panel-a@3dev.test', emailB = 'eval-panel-b@3dev.test';

async function userId(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email)?.id;
}
async function cleanup() {
  for (const email of [emailA, emailB]) {
    const id = await userId(email);
    if (id) await admin.auth.admin.deleteUser(id);
  }
  for (const c of [A, B]) {
    await must(admin.from('handoffs').delete().eq('client_id', c));
    await must(admin.from('leads').delete().eq('client_id', c));
    await must(admin.from('follow_ups').delete().eq('client_id', c));
    await must(admin.from('contacts').delete().eq('client_id', c));
  }
}
/** A session without sending an email: the admin API hands back the same OTP the email would carry. */
async function signedIn(email) {
  const link = await must(admin.auth.admin.generateLink({ type: 'magiclink', email }));
  const sb = anonClient();
  await must(sb.auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' }));
  return sb;
}

await cleanup();
try {
  for (const [email, client] of [[emailA, A], [emailB, B]]) {
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
    await must(admin.from('dashboard_users').insert({ user_id: data.user.id, client_id: client }));
    await must(admin.from('contacts').insert({ client_id: client, contact_id: `eval-${client}`, channel: 'web', left_contact: false }));
    await must(admin.from('messages').insert({ client_id: client, contact_id: `eval-${client}`, role: 'user', content: `hola desde ${client}` }));
    await must(admin.from('leads').insert({ client_id: client, contact_id: `eval-${client}`, channel: 'web', nombre: client, contacto: 'x@3dev.test' }));
  }

  const a = await signedIn(emailA);
  for (const table of ['contacts', 'messages', 'leads']) {
    const rows = await must(a.from(table).select('client_id').in('client_id', [A, B]));
    assert.deepEqual([...new Set(rows.map((r) => r.client_id))], [A], `${table}: A solo ve su cliente`);
  }
  const access = await must(a.from('dashboard_users').select('client_id'));
  assert.deepEqual(access.map((r) => r.client_id), [A], 'A solo ve su propio acceso');

  const ins = await a.from('leads').insert({ client_id: A, contact_id: 'eval-x', channel: 'web', nombre: 'x', contacto: 'x' });
  assert.ok(ins.error, 'A no puede insertar');
  const upd = await a.from('contacts').update({ name: 'hack' }).eq('client_id', A).select();
  assert.ok(upd.error || upd.data.length === 0, 'A no puede actualizar');
  const del = await a.from('messages').delete().eq('client_id', A).select();
  assert.ok(del.error || del.data.length === 0, 'A no puede borrar');
  const grant = await a.from('dashboard_users').insert({ user_id: (await a.auth.getUser()).data.user.id, client_id: B });
  assert.ok(grant.error, 'A no se puede dar acceso a otro cliente');

  // Writes the handoff needs, and nothing more.
  const uidA = (await a.auth.getUser()).data.user.id;
  const human = await a.from('messages').insert({ client_id: A, contact_id: `eval-${A}`, role: 'human', content: 'te contesto yo' });
  assert.ok(!human.error, `A escribe como humano en su cliente: ${human.error?.message}`);
  for (const [row, why] of [
    [{ client_id: A, contact_id: `eval-${A}`, role: 'assistant', content: 'x' }, 'no puede hacerse pasar por el asistente'],
    [{ client_id: A, contact_id: `eval-${A}`, role: 'user', content: 'x' }, 'no puede inventar mensajes de la persona'],
    [{ client_id: B, contact_id: `eval-${B}`, role: 'human', content: 'x' }, 'no escribe en otro cliente'],
  ]) assert.ok((await a.from('messages').insert(row)).error, `A ${why}`);

  const future = new Date(Date.now() + 3600_000).toISOString();
  const uidBForSpoof = await userId(emailB);
  for (const [row, why] of [
    [{ taken_by: uidBForSpoof, taken_by_email: emailB }, 'no toma a nombre de otra persona'],
    [{ taken_by: uidA, taken_by_email: 'otro@3dev.test' }, 'no pone otro correo'],
    [{ taken_by: uidA, taken_by_email: emailA, last_human_at: future }, 'no la deja tomada para siempre'],
    [{ taken_by: uidA, taken_by_email: emailA, notified_at: future }, 'no silencia los avisos a futuro'],
  ]) assert.ok((await a.from('handoffs').upsert({ client_id: A, contact_id: `eval-${A}`, ...row })).error, `A ${why}`);
  const take = await a.from('handoffs').upsert({ client_id: A, contact_id: `eval-${A}`, taken_by: uidA, taken_by_email: emailA });
  assert.ok(!take.error, `A toma en su cliente: ${take.error?.message}`);
  assert.ok((await a.from('handoffs').insert({ client_id: B, contact_id: `eval-${B}`, taken_by: uidA, taken_by_email: emailA })).error, 'A no toma en otro cliente');
  const uidB = await userId(emailB);
  await must(admin.from('handoffs').insert({ client_id: B, contact_id: `eval-${B}`, taken_by: uidB, taken_by_email: emailB }));
  const seen = await must(a.from('handoffs').select('client_id'));
  assert.deepEqual(seen.map((r) => r.client_id), [A], 'A no ve tomas de otro cliente');
  const freed = await a.from('handoffs').delete().eq('client_id', B).select();
  assert.ok(freed.error || freed.data.length === 0, 'A no devuelve tomas de otro cliente');
  const back = await a.from('handoffs').delete().eq('client_id', A).select();
  assert.equal(back.data?.length, 1, 'A devuelve la suya');

  const anon = await must(anonClient().from('messages').select('client_id').in('client_id', [A, B]));
  assert.equal(anon.length, 0, 'sin sesión no se ve nada');
  console.log('check-panel-rls: passed');
} finally {
  await cleanup();
}

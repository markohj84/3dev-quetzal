// Prueba purge_expired() contra la base real con client_id 'eval-purge'.
//   node --env-file=.env.local scripts/check-purge.mjs
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const C = 'eval-purge';
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const cleanup = async () => {
  await must(sb.from('follow_ups').delete().eq('client_id', C));
  await must(sb.from('contacts').delete().eq('client_id', C));
};

await cleanup();
try {
  await must(sb.from('contacts').insert([
    { client_id: C, contact_id: 'viejo', channel: 'whatsapp', name: 'Ana', interest: 'web', last_seen_at: ago(100), first_seen_at: ago(400) },
    { client_id: C, contact_id: 'reciente', channel: 'whatsapp', name: 'Luis', interest: 'tienda', last_seen_at: ago(5), first_seen_at: ago(5) },
  ]));
  await must(sb.from('messages').insert([
    { client_id: C, contact_id: 'viejo', role: 'user', content: 'hace más de un año', at: ago(400) },
    { client_id: C, contact_id: 'viejo', role: 'user', content: 'hace 100 días', at: ago(100) },
  ]));
  await must(sb.from('follow_ups').insert([
    { client_id: C, phone: '520000000001', reason: 'sent', at: ago(100) },
    { client_id: C, phone: '520000000002', reason: 'sent', at: ago(10) },
  ]));

  await must(sb.rpc('purge_expired'));

  const contacts = await must(sb.from('contacts').select('contact_id, name, interest').eq('client_id', C).order('contact_id'));
  assert.deepEqual(contacts, [
    { contact_id: 'reciente', name: 'Luis', interest: 'tienda' },
    { contact_id: 'viejo', name: null, interest: null },
  ], 'la ficha de 90 días se vacía, la reciente se queda, la fila sobrevive');
  const messages = await must(sb.from('messages').select('content').eq('client_id', C));
  assert.deepEqual(messages.map((m) => m.content), ['hace 100 días'], 'solo se borra lo de más de 12 meses');
  const marks = await must(sb.from('follow_ups').select('phone').eq('client_id', C));
  assert.deepEqual(marks.map((m) => m.phone), ['520000000002'], 'la marca de más de 90 días se borra');
  console.log('check-purge: passed');
} finally {
  await cleanup();
}

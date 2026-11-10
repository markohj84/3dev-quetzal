// forget-contact.mjs contra la base y el Redis reales, con clientes de mentira:
// borra todo lo de una persona y nada de nadie más.
//   node --env-file=.env.local scripts/check-forget.mjs
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { forgetContact } from './forget-contact.mjs';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const A = 'eval-forget-a', B = 'eval-forget-b';
// As WhatsApp reports a Mexican mobile (521…); Meta delivers to it, and follow_ups keeps it, as 52….
const PERSON = '5219990001111', OTHER = '5219990003333';
const rows = async (table, clientId, column, value) => (await must(db.from(table).select('*').eq('client_id', clientId).eq(column, value))).length;

async function cleanup() {
  for (const c of [A, B]) {
    for (const table of ['usage', 'follow_ups', 'leads', 'contacts']) await must(db.from(table).delete().eq('client_id', c));
    for (const id of [PERSON, OTHER]) await kv.del(`session:${c}:${id}`);
  }
}

await cleanup();
try {
  const at = new Date().toISOString();
  await must(db.from('contacts').insert([
    { client_id: A, contact_id: PERSON, channel: 'whatsapp', name: 'Ana', left_contact: true },
    { client_id: A, contact_id: OTHER, channel: 'whatsapp', left_contact: false },
    { client_id: B, contact_id: PERSON, channel: 'whatsapp', left_contact: false },
  ]));
  await must(db.from('messages').insert([
    { client_id: A, contact_id: PERSON, role: 'user', content: 'hola', at },
    { client_id: A, contact_id: PERSON, role: 'assistant', content: 'hola, Ana', at },
    { client_id: A, contact_id: OTHER, role: 'user', content: 'otra persona', at },
    { client_id: B, contact_id: PERSON, role: 'user', content: 'la misma persona con otro negocio', at },
  ]));
  // She also typed a second phone into the chat: the follow-up mark for it is hers too.
  await must(db.from('leads').insert([
    { client_id: A, contact_id: PERSON, channel: 'whatsapp', nombre: 'Ana', contacto: '999 000 2222', at },
    { client_id: A, contact_id: OTHER, channel: 'whatsapp', nombre: 'Luis', contacto: 'luis@example.com', at },
  ]));
  await must(db.from('usage').insert([
    { client_id: A, contact_id: PERSON, model: 'm', input_tokens: 10, output_tokens: 1 },
    { client_id: A, contact_id: OTHER, model: 'm', input_tokens: 10, output_tokens: 1 },
  ]));
  await must(db.from('follow_ups').insert([
    { client_id: A, phone: '529990001111', reason: 'sent', at },
    { client_id: A, phone: '529990002222', reason: 'sent', at },
    { client_id: A, phone: '529990003333', reason: 'booked', at },
    { client_id: B, phone: '529990001111', reason: 'sent', at },
  ]));
  await kv.set(`session:${A}:${PERSON}`, { history: [], hasOffered: false }, { ex: 600 });
  await kv.set(`session:${A}:${OTHER}`, { history: [], hasOffered: false }, { ex: 600 });

  // Without the word, it only counts.
  const found = await forgetContact({ db, kv }, A, PERSON);
  assert.deepEqual(found, { contacts: 1, messages: 2, leads: 1, usage: 1, followUps: 2, sessions: 1 }, 'cuenta lo que hay de esa persona');
  assert.equal(await rows('messages', A, 'contact_id', PERSON), 2, 'contar no borra');

  const erased = await forgetContact({ db, kv }, A, PERSON, { erase: true });
  assert.deepEqual(erased, found, 'borra lo mismo que contó');
  for (const table of ['contacts', 'messages', 'leads', 'usage']) {
    assert.equal(await rows(table, A, 'contact_id', PERSON), 0, `${table}: no queda nada de la persona`);
  }
  assert.equal(await rows('follow_ups', A, 'phone', '529990001111') + await rows('follow_ups', A, 'phone', '529990002222'), 0, 'ni las marcas de seguimiento de sus dos teléfonos');
  assert.equal(await kv.get(`session:${A}:${PERSON}`), null, 'ni la conversación en curso');
  assert.deepEqual(await forgetContact({ db, kv }, A, PERSON), { contacts: 0, messages: 0, leads: 0, usage: 0, followUps: 0, sessions: 0 }, 'una segunda pasada no encuentra nada');

  // Nobody else is touched: not another person of the same client, not the same person at another client.
  assert.equal(await rows('messages', A, 'contact_id', OTHER), 1);
  assert.equal(await rows('leads', A, 'contact_id', OTHER), 1);
  assert.equal(await rows('usage', A, 'contact_id', OTHER), 1);
  assert.equal(await rows('follow_ups', A, 'phone', '529990003333'), 1);
  assert.ok(await kv.get(`session:${A}:${OTHER}`), 'la sesión de otra persona sigue');
  assert.equal(await rows('messages', B, 'contact_id', PERSON), 1, 'lo que habló con otro negocio es de ese negocio');
  assert.equal(await rows('follow_ups', B, 'phone', '529990001111'), 1);

  console.log('check-forget: passed');
} finally {
  await cleanup();
}

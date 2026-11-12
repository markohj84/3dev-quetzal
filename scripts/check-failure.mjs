// When a reply does not reach the person, someone is told, once an hour per kind: the assistant
// could not answer (the person's message is kept), or Meta reported a delivery that never arrived.
// The dev server gets a model key that does not work and a webhook that points here:
//   ANTHROPIC_API_KEY=mal WHATSAPP_APP_SECRET=local NOTIFY_WEBHOOK_URL=http://127.0.0.1:8788/hook npm run dev
//   WHATSAPP_APP_SECRET=local node --env-file=.env.local scripts/check-failure.mjs [clientId]
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { Redis } from '@upstash/redis';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const CLIENT_ID = process.argv[2] ?? 'quetzal-3dev';
const SECRET = process.env.WHATSAPP_APP_SECRET;
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

// Stands in for the client's flow: the alert is one more event on its webhook.
const events = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    events.push(JSON.parse(body));
    res.end('ok');
  });
});
await new Promise((resolve) => receiver.listen(8788, '127.0.0.1', resolve));

const stamp = Date.now();
const web = `eval-failure-${stamp}`;
// No digits: nothing in it Meta could take for a phone number.
const wa = `eval-wa-failure-${Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
// Alerts are rationed per client, kind and hour: a run inside the same hour as another starts clean.
// "local" is where a dev server keeps its ration, apart from production's, which lives in the same Redis.
const rations = ['answer', 'delivery'].map((kind) => `ratelimit:failed:local:${kind}:${CLIENT_ID}:${Math.floor(stamp / 1000 / 3600)}`);
const signed = (body) =>
  fetch(`${BASE}/api/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex') },
    body,
  });
const roles = async (contactId) =>
  (await admin.from('messages').select('role, content').eq('client_id', CLIENT_ID).eq('contact_id', contactId).order('id')).data.map((m) => m.role);
const chat = (text) =>
  fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: web, text }) });

try {
  await kv.del(...rations);

  assert.equal((await chat('¿Cuánto cuesta una página?')).status, 502, 'sin modelo, el chat contesta 502 (¿el dev server tiene ANTHROPIC_API_KEY=mal?)');
  assert.equal((await chat('¿Hay alguien?')).status, 502);
  assert.deepEqual(await roles(web), ['user', 'user'], 'lo que la persona escribió queda en la transcripción, sin respuesta');

  if (!SECRET) {
    console.log('webhook de WhatsApp: saltado (falta WHATSAPP_APP_SECRET)');
  } else {
    const body = JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID },
      messages: [{ from: wa, timestamp: String(Math.floor(stamp / 1000)), text: { body: '¿Tienen cita mañana?' } }],
    } }] }] });
    assert.equal((await signed(body)).status, 200, 'a Meta se le contesta 200 aunque el asistente falle');
    assert.deepEqual(await roles(wa), ['user'], 'el mensaje de WhatsApp queda en la transcripción');
    const session = await kv.get(`session:${CLIENT_ID}:${wa}`);
    assert.deepEqual(session?.history, [{ role: 'user', content: '¿Tienen cita mañana?' }], 'y en la sesión, para quien conteste después');
    assert.ok(session?.startedAt, 'la sesión nacida de una falla marca cuándo empezó');

    // Meta accepted a message of the assistant's and reports later that it never arrived
    // (here, the payment method failed): the only notice there is, and it comes as a receipt.
    const receipt = (recipient) => JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID },
      statuses: [{ status: 'failed', recipient_id: recipient, errors: [{ code: 131042, title: 'Business eligibility payment issue' }] }],
    } }] }] });
    assert.equal((await signed(receipt('520000000001'))).status, 200);
    assert.equal((await signed(receipt('520000000002'))).status, 200);
  }

  // The alerts go out after the response: give them a moment.
  const expected = SECRET ? 2 : 1;
  for (let i = 0; i < 30 && events.length < expected; i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(events.length, expected, `un aviso por tipo de falla y hora: llegaron ${events.length} (¿el dev server tiene NOTIFY_WEBHOOK_URL=http://127.0.0.1:8788/hook?)`);
  const [event, undelivered] = events;
  if (SECRET) {
    assert.equal(undelivered.event, 'failure');
    assert.equal(undelivered.contactId, '520000000001', 'dos entregas fallidas en la hora, un solo aviso: el de la primera');
    assert.match(undelivered.failure.error, /131042/, 'el aviso trae el motivo que dio Meta');
    assert.equal(undelivered.failure.text, undefined, 'no hay mensaje de la persona que citar');
  }
  assert.equal(event.event, 'failure');
  assert.equal(event.clientId, CLIENT_ID);
  assert.equal(event.contactId, web);
  assert.equal(event.failure.text, '¿Cuánto cuesta una página?', 'el aviso trae el mensaje que se quedó sin respuesta');
  assert.ok(event.failure.error.length > 0 && event.failure.error.length <= 300, 'y el error, corto');

  console.log('check-failure: passed');
} finally {
  receiver.close();
  await kv.del(...rations, `session:${CLIENT_ID}:${wa}`);
  for (const id of [web, wa]) await admin.from('contacts').delete().eq('client_id', CLIENT_ID).eq('contact_id', id);
}

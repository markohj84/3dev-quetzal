// A shared deploy answers as the right client for each host.
//   MULTI_TENANT=1 npm run dev                      # sin CLIENT
//   node --env-file=.env.local scripts/check-tenants.mjs
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const as = (host, path, init = {}) =>
  fetch(`${BASE}${path}`, { redirect: 'manual', ...init, headers: { 'x-forwarded-host': host, ...(init.headers ?? {}) } });
const THREEDEV = 'quetzal.3dev.mx', DEMO = 'demo.3dev.mx';
const ids = [];
const PANEL_USER = 'eval-tenants-owner@3dev.test';
const userId = async (email) => (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)?.id;

try {
  // Each host serves its own client's widget.
  const w3 = await (await as(THREEDEV, '/widget')).text();
  const wd = await (await as(DEMO, '/widget')).text();
  assert.notEqual(w3, wd, 'cada dominio sirve su propio widget');
  assert.match(wd, /Nogal/i, 'el demo sirve el widget de la clínica');
  assert.doesNotMatch(w3, /Nogal/i, '3dev no sirve el widget de la clínica');

  // The home page is the demo's alone.
  assert.equal((await as(DEMO, '/')).status, 200);
  assert.equal((await as(THREEDEV, '/')).status, 404, '3dev no tiene página de inicio propia');

  // Nobody's host is a 404 everywhere, never another client.
  for (const path of ['/widget', '/', '/panel/entrar']) {
    assert.equal((await as('otro.example.com', path)).status, 404, `${path} en un dominio desconocido`);
  }
  const unknownChat = await as('otro.example.com', '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'eval-tenants-x', text: 'hola' }) });
  assert.equal(unknownChat.status, 404, '/api/chat en un dominio desconocido');
  assert.equal((await as('quetzal.3dev.mx.evil.example', '/widget')).status, 404, 'un dominio que solo empieza igual no cuenta');

  // A chat lands under the client of its host.
  for (const [host, clientId] of [[THREEDEV, 'quetzal-3dev'], [DEMO, 'demo-dental']]) {
    const id = `eval-tenants-${clientId}-${Date.now()}`;
    ids.push([clientId, id]);
    const res = await as(host, '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, text: '¿Qué hacen ustedes?' }) });
    assert.equal(res.status, 200, `chat en ${host}`);
    const { data } = await admin.from('messages').select('client_id').eq('contact_id', id);
    assert.deepEqual([...new Set(data.map((m) => m.client_id))], [clientId], `el chat de ${host} se guardó como ${clientId}`);
  }

  // The panel of a host with no access for the signed-in user is closed (login page renders per host).
  const entrar = await (await as(DEMO, '/panel/entrar')).text();
  assert.match(entrar, /Nogal/i, 'el login del panel lleva el nombre del cliente del dominio');

  // The panel: someone with access to one client is a stranger at the other's domain,
  // even though both are served by this one process.
  {
    const { data } = await admin.auth.admin.createUser({ email: PANEL_USER, email_confirm: true });
    await admin.from('dashboard_users').insert({ user_id: data.user.id, client_id: 'demo-dental' });
    const jar = new Map();
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) },
    });
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: PANEL_USER });
    await sb.auth.verifyOtp({ email: PANEL_USER, token: link.data.properties.email_otp, type: 'email' });
    await new Promise((r) => setTimeout(r, 50));
    const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
    const at = async (host) => (await as(host, '/panel', { headers: { cookie } })).text();
    assert.doesNotMatch(await at(DEMO), /No tienes acceso/, 'en el dominio de su cliente entra');
    assert.match(await at(THREEDEV), /No tienes acceso/, 'en el dominio de otro cliente no');
  }

  // The WhatsApp webhook: the number it arrived at says whose it is, and that
  // client's signature secret checks it. Needs the dev server started with
  //   QUETZAL_3DEV__WHATSAPP_PHONE_NUMBER_ID=111222333 WHATSAPP_APP_SECRET=local
  const SECRET = process.env.WHATSAPP_APP_SECRET;
  const NUMBER = process.env.QUETZAL_3DEV__WHATSAPP_PHONE_NUMBER_ID;
  if (!SECRET || !NUMBER) {
    console.log('webhook de WhatsApp: saltado (falta WHATSAPP_APP_SECRET o QUETZAL_3DEV__WHATSAPP_PHONE_NUMBER_ID)');
  } else {
    const from = `eval-wa-tenants-${Date.now()}`;
    ids.push(['quetzal-3dev', from], ['demo-dental', from]);
    const body = (to) => JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: to }, messages: [{ from, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: 'hola' } }] } }] }] });
    const sign = (b) => 'sha256=' + createHmac('sha256', SECRET).update(b).digest('hex');
    const post = (b, signature) => as(DEMO, '/api/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: b });

    const known = body(NUMBER);
    assert.equal((await post(known, 'sha256=00')).status, 403, 'número conocido con firma falsa: se rechaza');
    const rowsFor = async (clientId) => (await admin.from('messages').select('id').eq('client_id', clientId).eq('contact_id', from)).data.length;
    assert.equal((await post(body('000999'), sign(body('000999')))).status, 200, 'número de nadie: 200 sin hacer nada');
    assert.equal(await rowsFor('quetzal-3dev') + await rowsFor('demo-dental'), 0, 'número de nadie: no se guardó nada');
    // The message is addressed to 3dev's number but sent to the demo's host: the number decides, not the host.
    assert.equal((await post(known, sign(known))).status, 200);
    assert.ok((await rowsFor('quetzal-3dev')) >= 2, 'el mensaje es de 3dev (por el número), no del demo (por el host)');
    assert.equal(await rowsFor('demo-dental'), 0);
  }

  console.log('check-tenants: passed');
} finally {
  const stranger = await userId(PANEL_USER);
  if (stranger) await admin.auth.admin.deleteUser(stranger);
  for (const [clientId, id] of ids) await admin.from('contacts').delete().eq('client_id', clientId).eq('contact_id', id);
}

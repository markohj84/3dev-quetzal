// Páginas del panel contra el dev server, con una sesión real y sin mandar correos.
//   CLIENT=demo-dental npm run dev                        # otra terminal
//   node --env-file=.env.demo-dental scripts/check-panel-pages.mjs demo-dental
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const [clientId] = process.argv.slice(2);
const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const OWNER = 'eval-panel-owner@3dev.test', STRANGER = 'eval-panel-stranger@3dev.test';
// Not eval-*: the panel hides eval traffic, like the report does. NOISE is that traffic.
const WA = 'panelcheck-wa', WEB = 'panelcheck-web', NOISE = 'eval-panelcheck-noise';

async function userId(email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email)?.id;
}
async function cleanup() {
  for (const email of [OWNER, STRANGER]) { const id = await userId(email); if (id) await admin.auth.admin.deleteUser(id); }
  await must(admin.from('leads').delete().eq('client_id', clientId).in('contact_id', [WA, WEB, NOISE]));
  await must(admin.from('contacts').delete().eq('client_id', clientId).in('contact_id', [WA, WEB, NOISE]));
}
/** The exact cookies @supabase/ssr would set after typing the code, built offline. */
async function sessionCookie(email) {
  const jar = new Map();
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const link = await must(admin.auth.admin.generateLink({ type: 'magiclink', email }));
  await must(sb.auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' }));
  await new Promise((r) => setTimeout(r, 50));
  return [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
}
const get = (path, cookie) => fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });

await cleanup();
try {
  const owner = (await must(admin.auth.admin.createUser({ email: OWNER, email_confirm: true }))).user;
  await must(admin.auth.admin.createUser({ email: STRANGER, email_confirm: true }));
  await must(admin.from('dashboard_users').insert({ user_id: owner.id, client_id: clientId }));
  const now = Date.now();
  const at = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
  await must(admin.from('contacts').insert([
    { client_id: clientId, contact_id: WA, channel: 'whatsapp', name: 'Ana Panel', interest: 'limpieza', left_contact: true, last_seen_at: at(5) },
    { client_id: clientId, contact_id: WEB, channel: 'web', name: null, interest: null, left_contact: false, last_seen_at: at(60) },
  ]));
  await must(admin.from('messages').insert([
    { client_id: clientId, contact_id: WA, role: 'user', content: 'Quiero una limpieza el jueves', at: at(6) },
    { client_id: clientId, contact_id: WA, role: 'assistant', content: 'Con gusto, ¿a qué hora?', at: at(5) },
    { client_id: clientId, contact_id: WEB, role: 'user', content: '¿Cuánto cuesta la valoración?', at: at(60) },
  ]));
  await must(admin.from('contacts').insert({ client_id: clientId, contact_id: NOISE, channel: 'web', name: 'Eval Ruido', left_contact: false, last_seen_at: at(2) }));
  await must(admin.from('messages').insert({ client_id: clientId, contact_id: NOISE, role: 'user', content: 'mensaje de eval', at: at(2) }));
  await must(admin.from('leads').insert({ client_id: clientId, contact_id: NOISE, channel: 'web', nombre: 'Eval Ruido', contacto: 'ruido@3dev.test', at: at(2) }));
  await must(admin.from('leads').insert({ client_id: clientId, contact_id: WEB, channel: 'web', nombre: 'Luis Panel', contacto: 'luis.panel@3dev.test', necesidad: 'ortodoncia', at: at(59) }));

  // Sin sesión y con cookie basura: a entrar, nunca un 500.
  let r = await get('/panel');
  assert.ok([302, 303, 307].includes(r.status) && r.headers.get('location')?.includes('/panel/entrar'), `sin sesión: ${r.status}`);
  // Right cookie name for this project, garbage value: the parse path, not just an unknown cookie.
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host.split('.')[0];
  r = await get('/panel', `sb-${ref}-auth-token=basura`);
  assert.ok([302, 303, 307].includes(r.status), `cookie basura: ${r.status}`);
  // An RSC request that claims the layout is already on the client renders only the page:
  // the layout's checks don't run there, so the page must not trust them.
  const rsc = (cookie) => fetch(`${BASE}/panel?dias=90`, {
    redirect: 'manual',
    headers: {
      RSC: '1',
      'Next-Router-State-Tree': encodeURIComponent(JSON.stringify(['', { children: ['panel', { children: ['(app)', { children: ['__PAGE__', {}] }] }] }, null, null, true])),
      ...(cookie ? { cookie } : {}),
    },
  });
  r = await rsc();
  assert.ok([302, 303, 307].includes(r.status), `RSC sin sesión debe redirigir, respondió ${r.status}`);
  r = await get('/panel/entrar');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Enviarme un código/);

  // The form must take the whole code Supabase sends, whatever length the project is set to.
  const otpLength = (await must(admin.auth.admin.generateLink({ type: 'magiclink', email: OWNER }))).properties.email_otp.length;
  const step2 = await (await get(`/panel/entrar?correo=${encodeURIComponent(OWNER)}&estado=enviado`)).text();
  const maxLength = Number(step2.match(/name="token"[^>]*maxLength="(\d+)"/i)?.[1] ?? step2.match(/maxLength="(\d+)"[^>]*name="token"/i)?.[1] ?? Infinity);
  assert.ok(maxLength >= 10, `el campo del código corta a ${maxLength} (Supabase manda ${otpLength}; puede cambiar a 8)`);

  const cookie = await sessionCookie(OWNER);
  const page = async (path) => { const res = await get(path, cookie); assert.equal(res.status, 200, `${path}: ${res.status}`); return res.text(); };
  const resumen = await page('/panel?dias=7');
  assert.match(resumen, /Luis Panel/, 'el resumen lista los leads recientes');
  const lista = await page('/panel/conversaciones?dias=7');
  assert.ok(lista.indexOf('Ana Panel') < lista.indexOf('Luis Panel'), 'la más reciente arriba; el nombre del lead si el contacto no tiene');
  assert.match(lista, /dejó datos/);
  for (const body of [resumen, lista, await page('/panel/leads')]) assert.doesNotMatch(body, /Eval Ruido|mensaje de eval/, 'el tráfico de evals no aparece');
  assert.match(await page('/panel/conversaciones?canal=whatsapp'), /Ana Panel/);
  assert.doesNotMatch(await page('/panel/conversaciones?canal=whatsapp'), /Luis Panel/, 'el filtro por canal funciona');
  const chat = await page(`/panel/conversaciones/${WA}`);
  assert.match(chat, /Quiero una limpieza el jueves/);
  assert.match(chat, /limpieza/);
  assert.match(await page(`/panel/conversaciones/${encodeURIComponent('no-existe/../x')}`), /Conversación no encontrada/);
  const leads = await page('/panel/leads');
  assert.match(leads, /mailto:luis\.panel@3dev\.test/);

  const strange = await get('/panel', await sessionCookie(STRANGER));
  assert.equal(strange.status, 200);
  const body = await strange.text();
  assert.match(body, /No tienes acceso a este panel/);
  assert.doesNotMatch(body, /Luis Panel/);
  const strangeRsc = await (await rsc(await sessionCookie(STRANGER))).text();
  assert.doesNotMatch(strangeRsc, /agendaron cita|personas escribieron/, 'otro cliente no recibe ni las cifras por RSC');

  r = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 400, 'el middleware no toca /api');
  console.log('check-panel-pages: passed');
} finally {
  await cleanup();
}

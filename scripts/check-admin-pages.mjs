// /admin contra el dev server, con sesión real y sin mandar correos.
//   npm run dev                                  # cualquier cliente; con MULTI_TENANT=1 revisa además el plan del demo
//   node --env-file=.env.local scripts/check-admin-pages.mjs
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const ROOT = 'eval-admpg-root@3dev.test', OWNER = 'eval-admpg-owner@3dev.test', C = 'eval-admpg-client';

const userId = async (email) => (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)?.id;
async function cleanup() {
  for (const e of [ROOT, OWNER]) { const id = await userId(e); if (id) await admin.auth.admin.deleteUser(id); }
  await must(admin.from('usage').delete().eq('client_id', C));
  await must(admin.from('contacts').delete().eq('client_id', C));
}
async function sessionCookie(email) {
  const jar = new Map();
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const link = await must(admin.auth.admin.generateLink({ type: 'magiclink', email }));
  await must(sb.auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' }));
  await new Promise((r) => setTimeout(r, 50));
  return [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
}
const get = (path, cookie, extra = {}) => fetch(`${BASE}${path}`, { redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...extra } });
const rsc = { RSC: '1', 'Next-Router-State-Tree': encodeURIComponent(JSON.stringify(['', { children: ['admin', { children: ['(app)', { children: ['__PAGE__', {}] }] }] }, null, null, true])) };

await cleanup();
try {
  const root = (await must(admin.auth.admin.createUser({ email: ROOT, email_confirm: true }))).user;
  await must(admin.auth.admin.createUser({ email: OWNER, email_confirm: true }));
  await must(admin.from('platform_admins').insert({ user_id: root.id }));
  await must(admin.from('contacts').insert({ client_id: C, contact_id: 'admpg-1', channel: 'web', left_contact: false }));
  await must(admin.from('messages').insert({ client_id: C, contact_id: 'admpg-1', role: 'user', content: 'secreto-de-la-conversacion', at: new Date().toISOString() }));

  await must(admin.from('usage').insert({ client_id: C, contact_id: 'admpg-1', model: 'claude-haiku-5-5', input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }));

  // Two more people on the 15th of last month, Mexico City time (UTC−6): out of the 7 days, in last month's count.
  const mx = new Date(Date.now() - 6 * 3600_000);
  const lastMonth = new Date(Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth() - 1, 15, 18)).toISOString();
  await must(admin.from('contacts').insert(['admpg-2', 'admpg-3'].map((id) => ({ client_id: C, contact_id: id, channel: 'web', left_contact: false }))));
  await must(admin.from('messages').insert(['admpg-2', 'admpg-3'].map((id) => ({ client_id: C, contact_id: id, role: 'user', content: 'x', at: lastMonth }))));

  // Sin sesión: a entrar, también por petición RSC; nunca cifras.
  let r = await get('/admin');
  assert.ok([302, 303, 307].includes(r.status) && r.headers.get('location')?.includes('/admin/entrar'), `sin sesión: ${r.status}`);
  r = await get('/admin?dias=90', null, rsc);
  assert.ok([302, 303, 307].includes(r.status), `RSC sin sesión debe redirigir, respondió ${r.status}`);
  r = await get('/admin/entrar');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-frame-options'), 'DENY', 'la administración no se deja enmarcar desde otro sitio');
  assert.match(await r.text(), /Administración de 3dev/);

  // Un dueño de cliente no es admin: ni la página ni el RSC dan cifras.
  const owner = await sessionCookie(OWNER);
  const ownerPage = await (await get('/admin', owner)).text();
  assert.match(ownerPage, /No tienes acceso/);
  assert.doesNotMatch(ownerPage, new RegExp(C));
  const ownerRsc = await get('/admin?dias=90', owner, rsc);
  assert.doesNotMatch(await ownerRsc.text(), new RegExp(C), 'RSC de un no-admin no trae clientes');

  // El admin ve la tabla, sin contenido de conversaciones.
  const rootCookie = await sessionCookie(ROOT);
  // React puts <!-- --> between adjacent text nodes.
  const page = (await (await get('/admin?dias=7', rootCookie)).text()).replace(/<!-- -->/g, '');
  assert.match(page, new RegExp(C), 'el admin ve el cliente');
  assert.match(page, /1 personas · 1 mensajes/);
  assert.doesNotMatch(page, /secreto-de-la-conversacion/, 'solo agregados');
  assert.match(page, /costo US\$0\.100/, 'el costo sale del uso guardado y la tabla de precios');
  assert.match(page, /US\$0\.100 por persona/);
  assert.match(page, /Personas este mes: 1 · mes pasado: 2/, 'el mes calendario se cuenta aparte del periodo');
  // A client with a plan is measured against it. Only when this dev server also serves the demo.
  const servesDemo = /Nogal/i.test(await (await fetch(`${BASE}/widget`, { headers: { 'x-forwarded-host': 'demo.3dev.mx' } })).text());
  if (servesDemo) assert.match(page, /Personas este mes: \d+ de 300/, 'el demo trae plan de 300');
  else console.log('plan del demo: saltado (este dev server no atiende demo.3dev.mx)');
  console.log('check-admin-pages: passed');
} finally {
  await cleanup();
}

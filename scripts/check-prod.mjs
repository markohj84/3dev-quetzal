// Producción después de un deploy: que cada dominio sirva el commit de origin/main
// y que las protecciones sigan puestas. Solo lee. Con --chat además le pregunta
// algo a cada asistente (cuesta centavos) y borra lo que esa pregunta guardó.
//   git fetch && node --env-file=.env.local scripts/check-prod.mjs [--chat]
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { Redis } from '@upstash/redis';
import { db } from '../core/store/db.ts';

const chat = process.argv.includes('--chat');
let failures = 0;
const ok = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg) => { failures++; console.log(`\x1b[31m✗\x1b[0m ${msg}`); };
const warn = (msg) => console.log(`\x1b[33m!\x1b[0m ${msg}`);
const get = (url, init = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000), ...init });

// A push to main has not always triggered Vercel: the domain says which commit it serves.
const expected = execFileSync('git', ['rev-parse', '--short=7', 'origin/main'], { encoding: 'utf8' }).trim();

const tenants = [];
for (const dir of await readdir('clients', { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith('_')) continue;
  const { default: config } = await import(`../clients/${dir.name}/assistant.config.ts`);
  for (const host of config.domains) tenants.push({ host, config });
}

for (const { host } of tenants) {
  const widget = await get(`https://${host}/widget`);
  const commit = widget.headers.get('x-commit');
  if (!commit) warn(`${host}: no dice qué commit corre (deploy anterior a X-Commit)`);
  else (commit === expected ? ok : bad)(`${host}: corre ${commit}${commit === expected ? '' : `, origin/main es ${expected}: ¿el push no disparó el deploy?`}`);
  (widget.status === 200 && !widget.headers.get('x-frame-options') ? ok : bad)(`${host}/widget: ${widget.status}, se deja incrustar`);
  (((await get(`https://${host}/privacidad`)).status === 200) ? ok : bad)(`${host}/privacidad`);
  const panel = await get(`https://${host}/panel/entrar`);
  (panel.status === 200 && panel.headers.get('x-frame-options') === 'DENY' ? ok : bad)(`${host}/panel/entrar: ${panel.status}, X-Frame-Options ${panel.headers.get('x-frame-options')}`);
}

// What the whole deploy guards, not one client.
const [first] = tenants;
const cron = await get(`https://${first.host}/api/cron/follow-up`);
(cron.status === 403 ? ok : bad)(`cron sin secreto: ${cron.status}`);
const wa = tenants.find((t) => t.config.channels.whatsapp.enabled && t.config.channels.whatsapp.phoneNumberId);
if (!wa) warn('webhook de WhatsApp: saltado (sin número en el entorno; corre con --env-file=.env.local)');
else {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: wa.config.channels.whatsapp.phoneNumberId } } }] }] });
  const forged = await get(`https://${wa.host}/api/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' }, body });
  (forged.status === 403 ? ok : bad)(`webhook con firma falsa: ${forged.status}`);
}
const project = JSON.parse(await readFile('.vercel/project.json', 'utf8').catch(() => '{}')).projectName;
if (project) {
  const stranger = await get(`https://${project}.vercel.app/widget`);
  (stranger.status === 404 ? ok : bad)(`un dominio que no es de nadie: ${stranger.status}`);
}

if (chat) {
  const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  for (const { host, config } of tenants) {
    const id = `eval-prod-${Date.now()}`;
    try {
      const res = await get(`https://${host}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, text: '¿Qué hacen ustedes?' }) });
      const text = res.ok ? (await res.json()).text : '';
      (text ? ok : bad)(`${host} contesta: ${text ? `"${text.replace(/\s+/g, ' ').slice(0, 70)}…"` : res.status}`);
    } finally {
      // Takes its messages with it.
      await db().from('contacts').delete().eq('client_id', config.id).eq('contact_id', id);
      await db().from('usage').delete().eq('client_id', config.id).eq('contact_id', id);
      await kv.del(`session:${config.id}:${id}`);
    }
  }
}

console.log(failures ? `\n${failures} problema(s) en producción.\n` : `\nProducción en orden (${expected}).\n`);
process.exitCode = failures ? 1 : 0;

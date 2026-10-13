/**
 * Revisa que un cliente esté listo para su primer deploy: archivos, config,
 * variables de entorno y que cada llave funcione de verdad.
 *
 *   node --env-file=.env.<cliente> scripts/client-check.ts <carpeta> [--create-templates]
 *
 * Con --create-templates da de alta en Meta las plantillas que falten (aviso
 * al dueño y seguimiento), con el texto que sale de su assistant.config.ts.
 * Meta las revisa: quedan PENDING unas horas.
 */
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const [folder, ...flags] = process.argv.slice(2);
if (!folder) {
  console.error('Uso: node --env-file=.env.<cliente> scripts/client-check.ts <carpeta> [--create-templates]');
  process.exit(1);
}
const createTemplates = flags.includes('--create-templates');
const dir = join(process.cwd(), 'clients', folder);
const env = process.env;

let failures = 0;
const ok = (msg: string) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg: string) => { failures++; console.log(`\x1b[31m✗\x1b[0m ${msg}`); };
const warn = (msg: string) => console.log(`\x1b[33m!\x1b[0m ${msg}`);
async function step(label: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    ok(detail ? `${label}: ${detail}` : label);
  } catch (error) {
    bad(`${label}: ${(error as Error).message}`);
  }
}
async function json(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body as any;
}

console.log(`\nCliente: clients/${folder}\n`);

// 1. Archivos
for (const file of ['assistant.config.ts', 'voice.md', 'widget.html', 'privacidad.tsx', 'evals.ts']) {
  await step(`archivo ${file}`, () => access(join(dir, file)));
}
await step('knowledge/', async () => {
  const md = (await readdir(join(dir, 'knowledge'))).filter((f) => f.endsWith('.md'));
  if (!md.length) throw new Error('sin archivos .md');
  return `${md.length} archivos`;
});

// 2. Config
let config: any;
await step('assistant.config.ts es válido', async () => {
  config = (await import(join(dir, 'assistant.config.ts'))).default;
  return `id ${config.id}`;
});
if (!config) {
  console.log(`\n${failures} problema(s). Sin config no se puede revisar lo demás.`);
  process.exit(1);
}

// 3. Variables que esta config necesita
const needed = ['ANTHROPIC_API_KEY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
const wa = config.channels.whatsapp.enabled;
if (wa) needed.push('WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_WABA_ID');
if (config.scheduling.provider === 'calcom') needed.push('CALCOM_API_KEY');
if (config.scheduling.provider === 'calendly') needed.push('CALENDLY_API_TOKEN');
if (config.notify.email) needed.push('RESEND_API_KEY');
if (config.notify.whatsapp) needed.push('NOTIFY_WHATSAPP_TO');
if (config.followUp) needed.push('CRON_SECRET');
for (const name of needed) (env[name] ? ok : bad)(`variable ${name}`);
if (env.CLIENT !== folder) warn(`CLIENT=${folder} debe estar en el proyecto de Vercel de este cliente`);

// 4. Que cada llave funcione
if (env.ANTHROPIC_API_KEY) {
  await step(`Anthropic (${config.model.model})`, async () => {
    await json(await fetch(`https://api.anthropic.com/v1/models/${config.model.model}`, {
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    }));
  });
}
if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
  await step('Redis (Upstash)', async () => {
    const body = await json(await fetch(`${env.KV_REST_API_URL}/ping`, { headers: { Authorization: `Bearer ${env.KV_REST_API_TOKEN}` } }));
    return body.result;
  });
}

const graph = (path: string, init: RequestInit = {}) =>
  fetch(`https://graph.facebook.com/v21.0/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...init.headers },
  }).then(json);

if (wa && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
  await step('número de WhatsApp', async () => {
    const n = await graph(`${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,platform_type,status`);
    if (n.platform_type !== 'CLOUD_API') throw new Error(`${n.display_phone_number} no está registrado en la API (platform_type ${n.platform_type})`);
    return `${n.display_phone_number} · ${n.verified_name} · ${n.status}`;
  });
}

if (wa && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_WABA_ID) {
  // The business writes first in both cases, so Meta only lets these through
  // as approved templates. Their text comes from the client's config.
  const templates: { name: string; text: string; example: string[] }[] = [];
  if (config.notify.whatsapp) {
    templates.push({
      name: config.notify.whatsapp.template,
      text: `Aviso de ${config.name}: {{1}}.\n\nNombre: {{2}}\nContacto: {{3}}\nDetalle: {{4}}\n\nLa conversación completa llegó a tu correo.`,
      example: ['lead capturado', 'Ana López', 'ana@ejemplo.com', 'Quiere información de precios'],
    });
  }
  if (config.followUp) {
    templates.push({ name: config.followUp.template, text: config.followUp.text.replace('{nombre}', '{{1}}'), example: ['Ana'] });
  }
  for (const t of templates) {
    await step(`plantilla de Meta ${t.name}`, async () => {
      const found = (await graph(`${env.WHATSAPP_WABA_ID}/message_templates?name=${t.name}&fields=name,status,category`)).data?.[0];
      if (found) {
        if (found.status !== 'APPROVED') throw new Error(`${found.status} (${found.category}) — hasta que Meta la apruebe, ese envío falla`);
        return `${found.status} (${found.category})`;
      }
      if (!createTemplates) throw new Error('no existe; corre de nuevo con --create-templates');
      const created = await graph(`${env.WHATSAPP_WABA_ID}/message_templates`, {
        method: 'POST',
        body: JSON.stringify({
          name: t.name,
          language: config.followUp?.language ?? 'es_MX',
          category: 'MARKETING',
          components: [{ type: 'BODY', text: t.text, example: { body_text: [t.example] } }],
        }),
      });
      throw new Error(`creada, ${created.status}: vuelve a correr esto cuando Meta la apruebe`);
    });
  }
}

if (config.scheduling.provider === 'calcom' && env.CALCOM_API_KEY) {
  const cal = (path: string, version: string) =>
    fetch(`https://api.cal.com/v2/${path}`, { headers: { Authorization: `Bearer ${env.CALCOM_API_KEY}`, 'cal-api-version': version } }).then(json);
  await step('Cal.com', async () => {
    const me = (await cal('me', '2024-06-14')).data;
    if (me.timeZone !== config.scheduling.timeZone) warn(`la zona de Cal.com (${me.timeZone}) no es la de la config (${config.scheduling.timeZone})`);
    return `${me.username} · ${me.timeZone}`;
  });
  await step(`evento de Cal.com ${config.scheduling.eventTypeId}`, async () => {
    if (!config.scheduling.eventTypeId) throw new Error('falta scheduling.eventTypeId en la config');
    const et = (await cal(`event-types/${config.scheduling.eventTypeId}`, '2024-06-14')).data;
    const field = (slug: string) => et.bookingFields?.find((f: any) => f.slug === slug);
    const phone = field('attendeePhoneNumber');
    // WhatsApp bookings only carry the sender's phone: with email required,
    // every one of them would have to stop and ask for it.
    if (wa && !(phone && !phone.hidden && phone.required)) {
      warn('en el evento, el teléfono no es obligatorio: en WhatsApp, agendar pedirá correo. Pon "Teléfono" visible y obligatorio, y el correo opcional');
    }
    return `${et.title} · ${et.lengthInMinutes} min`;
  });
}

if (config.notify.email && env.RESEND_API_KEY) {
  await step('Resend (dominio del remitente)', async () => {
    const domain = (config.notify.fromEmail ?? '').match(/@([^>\s]+)/)?.[1];
    if (!domain) throw new Error('notify.fromEmail no tiene dominio');
    const list = (await json(await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } }))).data ?? [];
    const found = list.find((d: any) => d.name === domain);
    if (!found) throw new Error(`${domain} no está dado de alta en Resend`);
    if (found.status !== 'verified') throw new Error(`${domain} está ${found.status}, no verificado`);
    return `${domain} verificado`;
  });
}

console.log(failures ? `\n${failures} problema(s) por resolver.\n` : '\nTodo listo para el primer deploy.\n');
process.exitCode = failures ? 1 : 0;

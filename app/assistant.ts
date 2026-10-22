import Anthropic from '@anthropic-ai/sdk';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { createEngine, loadCorpus } from '../core/engine';
import { createCalendlyScheduler } from '../core/scheduling/calendly';
import { createCalcomScheduler } from '../core/scheduling/calcom';
import { createNullScheduler } from '../core/scheduling/types';
import { createCatalog } from '../core/catalog';
import { clientEnv, envPrefix, isMultiTenant } from '../core/config/env';
import { normalizeHost, registryConflict, resolveTenant } from '../core/tenants';
import type { AssistantConfig } from '../core/config/schema';

/**
 * Two ways to run. By default one project is one client: CLIENT picks the
 * folder under clients/ and every request is theirs, as it always was. With
 * MULTI_TENANT=1 one deploy serves every folder under clients/ (except those
 * starting with "_") and each request is resolved by its domain, or for the
 * WhatsApp webhook by the number it arrived at.
 */
export const singleClientId = () => process.env.CLIENT || '3dev';

/** The folder name and the config's id agree only by convention: the registry keeps both. */
export interface Entry {
  folder: string;
  config: AssistantConfig;
  domains: string[];
  whatsappPhoneNumberId?: string;
}

export class UnknownTenantError extends Error {
  constructor(what: string) {
    super(`no client for ${what}`);
  }
}

export const clientDir = (folder: string) => join(process.cwd(), 'clients', folder);

let registry: Promise<Entry[]> | null = null;

async function loadEntry(folder: string): Promise<Entry> {
  const { default: config } = (await import(`../clients/${folder}/assistant.config.ts`)) as { default: AssistantConfig };
  return { folder, config, domains: config.domains, whatsappPhoneNumberId: config.channels.whatsapp.phoneNumberId };
}

/** Every client this deploy answers for. */
export async function listTenants(): Promise<Entry[]> {
  registry ??= (async () => {
    if (!isMultiTenant()) return [await loadEntry(singleClientId())];
    const folders = (await readdir(join(process.cwd(), 'clients'), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .map((d) => d.name);
    const entries = await Promise.all(folders.map(loadEntry));
    // Two clients that would answer for each other stop the deploy at startup.
    const conflict = registryConflict(
      entries.map((e) => ({ id: e.config.id, domains: e.domains, whatsappPhoneNumberId: e.whatsappPhoneNumberId })),
      envPrefix,
    );
    if (conflict) throw new Error(`clientes en conflicto: ${conflict}`);
    return entries;
  })().catch((error) => {
    registry = null;
    throw error;
  });
  return registry;
}

/** Which client a request for this host belongs to; null when it is nobody's. */
export async function tenantByHost(host: string): Promise<Entry | null> {
  const tenants = await listTenants();
  if (!isMultiTenant()) return tenants[0];
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) && process.env.CLIENT) {
    return tenants.find((t) => t.folder === process.env.CLIENT) ?? null;
  }
  return resolveTenant(tenants, { host });
}

/** The client a WhatsApp number belongs to; null when it is nobody's. */
export async function tenantByPhoneNumberId(phoneNumberId: string | undefined): Promise<Entry | null> {
  const tenants = await listTenants();
  if (!isMultiTenant()) return tenants[0];
  return resolveTenant(tenants, { phoneNumberId });
}

async function build(entry: Entry) {
  const { config, folder } = entry;
  const dir = clientDir(folder);
  const [voice, corpus] = await Promise.all([
    readFile(join(dir, config.voiceFile), 'utf8'),
    loadCorpus(join(dir, config.knowledgeDir)),
  ]);

  // Each client's own keys: a shared deploy never lends one client's to another.
  const secrets = {
    resendApiKey: clientEnv(config.id, 'RESEND_API_KEY'),
    whatsapp: {
      phoneNumberId: clientEnv(config.id, 'WHATSAPP_PHONE_NUMBER_ID'),
      token: clientEnv(config.id, 'WHATSAPP_ACCESS_TOKEN'),
    },
    // The Meta app belongs to the platform: one secret and one verify token for
    // every number under it, unless a client brings an app of its own.
    whatsappAppSecret: clientEnv(config.id, 'WHATSAPP_APP_SECRET') ?? process.env.WHATSAPP_APP_SECRET,
    whatsappVerifyToken: clientEnv(config.id, 'WHATSAPP_VERIFY_TOKEN') ?? process.env.WHATSAPP_VERIFY_TOKEN,
    calendlySigningKey: clientEnv(config.id, 'CALENDLY_WEBHOOK_SIGNING_KEY'),
  };

  const { provider, url, timeZone, earliestHour, latestHour } = config.scheduling;
  const scheduler = !url
    ? createNullScheduler()
    : provider === 'calcom'
      ? createCalcomScheduler(url, {
          apiKey: clientEnv(config.id, 'CALCOM_API_KEY'),
          eventTypeId: config.scheduling.eventTypeId,
          timeZone,
          locale: config.locale,
          earliestHour,
          latestHour,
        })
      : provider === 'calendly'
        ? createCalendlyScheduler(url, {
            token: clientEnv(config.id, 'CALENDLY_API_TOKEN'),
            eventTypeUri: config.scheduling.eventTypeUri,
            timeZone,
            locale: config.locale,
            earliestHour,
            latestHour,
          })
        : createNullScheduler();

  const engine = createEngine({
    config,
    voice,
    corpus,
    scheduler,
    catalog: config.catalog ? createCatalog(config.catalog as { url: string; description: string; maxRows: number }) : undefined,
    // The SDK's default waits up to 10 minutes per attempt: a stalled call
    // held a reply for 17 minutes in testing. Better a fast failure the route
    // can answer than a person staring at "escribiendo…".
    client: new Anthropic({
      apiKey: clientEnv(config.id, 'ANTHROPIC_API_KEY') ?? process.env.ANTHROPIC_API_KEY,
      timeout: 30_000,
      maxRetries: 1,
    }),
  });

  return { config, folder, dir, engine, corpus, scheduler, secrets };
}

export type Assistant = Awaited<ReturnType<typeof build>>;

const built = new Map<string, Promise<Assistant>>();

/** The assistant for one client, built once per process. */
export async function assistantFor(entry: Entry): Promise<Assistant> {
  let promise = built.get(entry.config.id);
  if (!promise) {
    promise = build(entry);
    built.set(entry.config.id, promise);
    // A failed build must not stay cached forever.
    promise.catch(() => built.delete(entry.config.id));
  }
  return promise;
}

/**
 * The assistant for the request being served, by its host. Throws
 * UnknownTenantError when the host is nobody's.
 */
export async function getAssistant(): Promise<Assistant> {
  const h = await headers();
  const host = normalizeHost(h.get('x-forwarded-host') ?? h.get('host'));
  const entry = await tenantByHost(host);
  if (!entry) throw new UnknownTenantError(`host "${host}"`);
  return assistantFor(entry);
}

/** For pages and server actions: an unknown host is a 404, not an error. */
export async function getAssistantOr404(): Promise<Assistant> {
  try {
    return await getAssistant();
  } catch (error) {
    if (error instanceof UnknownTenantError) notFound();
    throw error;
  }
}

/** For route handlers: null when the host is nobody's, so the route answers 404. */
export async function getAssistantOrNull(): Promise<Assistant | null> {
  try {
    return await getAssistant();
  } catch (error) {
    if (error instanceof UnknownTenantError) return null;
    throw error;
  }
}

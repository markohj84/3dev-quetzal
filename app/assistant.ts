import Anthropic from '@anthropic-ai/sdk';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createEngine, loadCorpus } from '../core/engine';
import { createCalendlyScheduler } from '../core/scheduling/calendly';
import { createCalcomScheduler } from '../core/scheduling/calcom';
import { createNullScheduler } from '../core/scheduling/types';
import { createCatalog } from '../core/catalog';

/**
 * One deployment, one client: CLIENT picks the folder under clients/. Each
 * client gets its own Vercel project from this same repo, with its own keys,
 * number and calendar — nothing is shared between them at runtime.
 */
export const CLIENT = process.env.CLIENT || '3dev';
export const CLIENT_DIR = join(process.cwd(), 'clients', CLIENT);

let cached: Awaited<ReturnType<typeof build>> | null = null;

async function build() {
  const { default: config } = await import(`../clients/${CLIENT}/assistant.config.ts`);
  const [voice, corpus] = await Promise.all([
    readFile(join(CLIENT_DIR, config.voiceFile), 'utf8'),
    loadCorpus(join(CLIENT_DIR, config.knowledgeDir)),
  ]);

  const { provider, url, timeZone, earliestHour, latestHour } = config.scheduling;
  const scheduler = !url
    ? createNullScheduler()
    : provider === 'calcom'
      ? createCalcomScheduler(url, {
          apiKey: process.env.CALCOM_API_KEY,
          eventTypeId: config.scheduling.eventTypeId,
          timeZone,
          locale: config.locale,
          earliestHour,
          latestHour,
        })
      : provider === 'calendly'
        ? createCalendlyScheduler(url, {
            token: process.env.CALENDLY_API_TOKEN,
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
    catalog: config.catalog ? createCatalog(config.catalog) : undefined,
    // The SDK's default waits up to 10 minutes per attempt: a stalled call
    // held a reply for 17 minutes in testing. Better a fast failure the route
    // can answer than a person staring at "escribiendo…".
    client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 }),
  });

  return { config, engine, corpus, scheduler };
}

export async function getAssistant() {
  cached ??= await build();
  return cached;
}

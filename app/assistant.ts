import Anthropic from '@anthropic-ai/sdk';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import config from '../clients/3dev/assistant.config';
import { createEngine, loadCorpus } from '../core/engine';
import { createCalendlyScheduler } from '../core/scheduling/calendly';
import { createNullScheduler } from '../core/scheduling/types';

/**
 * The only file that names a client. Swapping the import above and the
 * CLIENT_DIR constant points the whole deployment at a different client.
 */
const CLIENT_DIR = join(process.cwd(), 'clients', '3dev');

let cached: Awaited<ReturnType<typeof build>> | null = null;

async function build() {
  const [voice, corpus] = await Promise.all([
    readFile(join(CLIENT_DIR, config.voiceFile), 'utf8'),
    loadCorpus(join(CLIENT_DIR, config.knowledgeDir)),
  ]);

  const scheduler =
    config.scheduling.provider === 'calendly' && config.scheduling.url
      ? createCalendlyScheduler(config.scheduling.url)
      : createNullScheduler();

  const engine = createEngine({
    config,
    voice,
    corpus,
    scheduler,
    client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  });

  return { config, engine, corpus };
}

export async function getAssistant() {
  cached ??= await build();
  return cached;
}

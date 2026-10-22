import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAssistantOrNull } from '../assistant';

// Each client brings its own widget: name, colors and greeting are theirs.
const cached = new Map<string, string>();

// The opening chips come from the client config, not from widget.html, so a
// change in assistant.config.ts reaches the first screen the visitor sees —
// a hardcoded list there drifted from the config once already.
export async function GET() {
  const assistant = await getAssistantOrNull();
  if (!assistant) return new Response('Not found', { status: 404 });
  const { config, dir } = assistant;
  let html = cached.get(config.id);
  if (html === undefined) {
    const raw = await readFile(join(dir, 'widget.html'), 'utf8');
    const openers = JSON.stringify(config.channels.web.openers).replace(/</g, '\\u003c');
    html = raw.replace(/const OPENERS = \[[^\]]*\];/, `const OPENERS = ${openers};`);
    cached.set(config.id, html);
  }
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAssistant } from '../assistant';

const WIDGET_PATH = join(process.cwd(), 'app', 'widget', 'widget.html');

let cached: string | null = null;

// The opening chips come from the client config, not from widget.html, so a
// change in assistant.config.ts reaches the first screen the visitor sees —
// a hardcoded list there drifted from the config once already.
export async function GET() {
  if (cached === null) {
    const [html, { config }] = await Promise.all([readFile(WIDGET_PATH, 'utf8'), getAssistant()]);
    const openers = JSON.stringify(config.channels.web.openers).replace(/</g, '\\u003c');
    cached = html.replace(/const OPENERS = \[[^\]]*\];/, `const OPENERS = ${openers};`);
  }
  return new Response(cached, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

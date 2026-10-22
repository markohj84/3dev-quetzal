import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAssistantOrNull } from './assistant';

// A client may ship a page of its own at "/" (the sales demo does, so the
// chat can be tried on a site that looks like the prospect's). Without one,
// the root stays a 404, as it always was.
export async function GET() {
  const assistant = await getAssistantOrNull();
  if (!assistant) return new Response('Not found', { status: 404 });
  try {
    const html = await readFile(join(assistant.dir, 'home.html'), 'utf8');
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

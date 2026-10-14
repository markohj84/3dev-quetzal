import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLIENT_DIR } from './assistant';

// A client may ship a page of its own at "/" (the sales demo does, so the
// chat can be tried on a site that looks like the prospect's). Without one,
// the root stays a 404, as it always was.
export async function GET() {
  try {
    const html = await readFile(join(CLIENT_DIR, 'home.html'), 'utf8');
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

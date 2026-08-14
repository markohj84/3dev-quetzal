import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const WIDGET_PATH = join(process.cwd(), 'app', 'widget', 'widget.html');

let cached: string | null = null;

export async function GET() {
  cached ??= await readFile(WIDGET_PATH, 'utf8');
  return new Response(cached, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

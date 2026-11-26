import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAssistantOrNull } from '../../assistant';
import { quotePilotFor } from '../../../core/channels/quote-pilot';
import { orderSettings } from '../../../core/channels/order-pilot';

export async function GET() {
  const client = await getAssistantOrNull();
  const pilot = client && quotePilotFor(client.config.id);
  if (!pilot || Date.now() >= pilot.expiresAt * 1000 || !orderSettings(client.config.id,pilot.digest)) return new Response(null,{status:404});
  return new Response(await readFile(join(client.dir, 'piloto-pendientes.html')), {headers:{
    'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'no-referrer','Cache-Control':'private, no-store',
    'X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  }});
}

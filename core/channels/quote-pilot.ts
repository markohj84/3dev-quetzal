import assert from 'node:assert/strict';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { envPrefix } from '../config/env.ts';

const config = z.object({
  folio: z.string().regex(/^[a-z0-9-]{3,48}$/i),
  reply: z.string().trim().min(1).max(2400),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive(),
}).strict();
export type QuotePilot = z.infer<typeof config>;
export interface QuoteBinding {
  owner(): Promise<string | null>;
  claim(chat: string): Promise<boolean>;
}

export function quotePilotFor(clientId: string): QuotePilot | null {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return null;
  const value = process.env[envPrefix(clientId) + '__WHATSAPP_QUOTE_PILOT'];
  if (!value) return null;
  try { return config.parse(JSON.parse(value)); }
  catch { return null; }
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const inviteMessage = (token: string) => 'Vincular prueba ' + token;
export const isInvite = (text: string) => /^vincular prueba(?:\s|$)/i.test(text.trim());
export function acceptsToken(pilot: QuotePilot, token: string, now = Date.now()) {
  return now < pilot.expiresAt * 1000 && /^[\w-]{32}$/.test(token)
    && timingSafeEqual(Buffer.from(hash(token),'hex'), Buffer.from(pilot.digest,'hex'));
}

export async function pilotReply(pilot: QuotePilot, binding: QuoteBinding, sender: string, text: string, now = Date.now()) {
  const chat = hash(pilot.digest + ':' + sender);
  const order = text.trim();
  if (isInvite(order)) {
    const token = /^vincular prueba ([\w-]{32})$/i.exec(order)?.[1] ?? '';
    if (!acceptsToken(pilot, token, now) || !/^\d{6,15}$/.test(sender)) return 'La invitación no está disponible.';
    if (!(await binding.claim(chat)) && await binding.owner() !== chat) return 'La invitación ya fue utilizada.';
    return pilot.reply + '\n\nPuedes volver a consultar este folio con «¿Cómo va mi pedido?».';
  }
  if (now >= pilot.expiresAt * 1000) return null;
  const asks = order.toUpperCase() === pilot.folio.toUpperCase() || /^(?:¿?c[oó]mo va mi pedido\??|ver (?:mi solicitud|mis solicitudes)|(?:consultar|ver) (?:mi )?(?:pedido|cotizaci[oó]n))[.!?]?$/i.test(order);
  if (!asks || await binding.owner() !== chat) return null;
  return pilot.reply;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = 'A'.repeat(32);
  const pilot = {folio:'QA-01af', digest:hash(token), expiresAt:2000, reply:'Prueba privada'};
  let owner: string | null = null;
  const store: QuoteBinding = { owner:async () => owner, claim:async chat => {
    if (owner) return false;
    owner = chat;
    return true;
  }};
  const a = '12025550101', b = '12025550102';
  const send = (chat: string, text: string, now = 1000) => pilotReply(pilot, store, chat, text, now);
  assert.equal(await send(a, '¿Cómo va mi pedido?'),null);
  assert.equal(await send(b,inviteMessage('Z'.repeat(32))),'La invitación no está disponible.');
  const replies = await Promise.all([send(a,inviteMessage(token)),send(b,inviteMessage(token))]);
  assert.match(replies[0]!, /Prueba privada/);
  assert.doesNotMatch(replies[1]!, /Prueba privada/);
  assert.match((await send(a,inviteMessage(token)))!, /Prueba privada/);
  assert.equal(await send(a,'¿Cómo va mi pedido?'),pilot.reply);
  assert.equal(await send(b,pilot.folio),null);
  assert.equal(await send(a,'¿Qué sitios web ofrecen?'),null);
  assert.equal(await send(a,pilot.folio),pilot.reply);
  assert.equal(await send(a,pilot.folio,2000000),null);
  assert.equal(await send(a,inviteMessage(token),2000000),'La invitación no está disponible.');
}

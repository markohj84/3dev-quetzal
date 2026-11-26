import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { envPrefix } from '../config/env.ts';

export const areas = ['ventas', 'logistica'] as const;
export type Area = typeof areas[number];
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const settings = z.object({
  binding: digest, business: z.string().min(1), product: z.string().min(1),
  quantity: z.number().int().positive(), itemNames: z.array(z.string().min(1)).min(1),
  ventas: digest, logistica: digest,
}).refine(v => v.ventas !== v.logistica);
export type OrderSettings = z.infer<typeof settings>;

export function orderSettings(id: string, binding: string) {
  const raw = process.env[envPrefix(id) + '__WHATSAPP_ORDER_PILOT'];
  if (!raw) return null;
  try {
    const value = settings.parse(JSON.parse(raw));
    return value.binding === binding ? value : null;
  } catch { return null; }
}

export function deskRole(config: OrderSettings, authorization: string | null): Area | null {
  const token = /^Bearer ([\w-]{43})$/.exec(authorization ?? '')?.[1];
  if (!token) return null;
  const hash = createHash('sha256').update(token).digest();
  return areas.find(role => timingSafeEqual(hash, Buffer.from(config[role], 'hex'))) ?? null;
}

type Status = 'sending' | 'accepted' | 'delivered' | 'read' | 'failed' | 'uncertain';
type Decision = { value: string | number; at: string; status: Status; attempt: string };
export type Order = {
  revision: number; folio: string; recipient: string; created: string;
  product: string; quantity: number; ventas: Decision | null; logistica: Decision | null;
};
export interface OrderStore {
  read(): Promise<Order | null>;
  save(revision: number, next: Order): Promise<boolean>;
}

// The same compare-and-set guards creation, both desks and out-of-order Meta callbacks.
async function update(store: OrderStore, change: (previous: Order | null) => Order | null) {
  for (let i = 0; i < 12; i++) {
    const previous = await store.read();
    const next = change(previous);
    if (next === previous || !next) return previous;
    const revision = previous?.revision ?? 0;
    next.revision = revision + 1;
    if (await store.save(revision, next)) return next;
  }
  throw new Error('Vuelve a intentar la operación.');
}

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[¿?¡!.,]+/g, '').replace(/\s+/g, ' ').trim();
export function wantsOrder(text: string, config: OrderSettings) {
  const words = normalize(text).replace(/^(?:hola |buen dia )/, '').replace(/ por favor$/, '');
  const item = words.match(/^(?:(?:quiero|quisiera|necesito|solicito)(?: (?:pedir|cotizar|comprar|solicitar))?|cotizar|pedir|cotizame|solicitud de prueba) (?:los )?(\d+) (.+)$/);
  return !!item && Number(item[1]) === config.quantity && config.itemNames.some(name => normalize(name) === item[2]);
}

export function newOrder(store: OrderStore, config: OrderSettings, sender: string) {
  return update(store, old => old ?? {
    revision: 0, folio: 'MS-' + randomUUID().slice(0,13), recipient: sender,
    created: new Date().toISOString(), product: config.product, quantity: config.quantity,
    ventas: null, logistica: null,
  });
}

const peso = new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' });
const date = new Intl.DateTimeFormat('es-MX', { dateStyle:'long', timeZone:'UTC' });
export function details(order: Order) {
  const cents = Number(order.ventas?.value);
  return {
    price: order.ventas ? 'Ventas autorizó ' + peso.format(cents / 100) + ' MXN por unidad. Total por ' + order.quantity + ': ' + peso.format(cents * order.quantity / 100) + ' MXN.' : 'Precio pendiente de Ventas.',
    delivery: order.logistica ? 'Logística confirmó la entrega de las ' + order.quantity + ' unidades para el ' + date.format(new Date(order.logistica.value + 'T12:00:00Z')) + '.' : 'Entrega pendiente de Logística.',
  };
}
export function orderText(order: Order, business: string, area?: Area) {
  const {price, delivery} = details(order);
  const lines = area === 'ventas' ? [price] : area === 'logistica' ? [delivery] : [price, delivery];
  return ['Prueba de ' + business, order.folio + ' · ' + order.quantity + ' ' + order.product, ...lines].join('\n');
}

export const deskDecision = z.discriminatedUnion('area', [
  z.object({area:z.literal('ventas'), folio:z.string(), unitCents:z.number().int().min(1).max(100_000_000), retry:z.boolean().optional()}).strict(),
  z.object({area:z.literal('logistica'), folio:z.string(), deliveryDate:z.string().date(), fullOrderConfirmed:z.literal(true), retry:z.boolean().optional()}).strict(),
]);
export class DeskConflict extends Error {}

// Commit the business decision and reserve its one outbound notification together.
export async function decide(store: OrderStore, input: z.infer<typeof deskDecision>, today: string) {
  const area = input.area;
  const value = input.area === 'ventas' ? input.unitCents : input.deliveryDate;
  const attempt = randomUUID();
  const at = new Date().toISOString();
  const order = await update(store, old => {
    if (!old || old.folio !== input.folio) throw new DeskConflict('El folio no está en esta bandeja.');
    const saved = old[area];
    if (saved && saved.value !== value) throw new DeskConflict('Esta área ya registró otra decisión.');
    if (saved && !(input.retry && saved.status === 'failed')) return old;
    if (!saved && input.area === 'logistica' && value < today) throw new DeskConflict('Elige hoy o una fecha posterior.');
    return { ...old, [area]: {value, at:saved?.at ?? at, attempt, status:'sending'} };
  });
  return {order, shouldSend:order[area].attempt === attempt, attempt};
}

export function markNotification(store: OrderStore, folio: string, area: Area, attempt: string, status: Status) {
  const rank = {sending:0, uncertain:1, accepted:2, failed:3, delivered:4, read:5};
  return update(store, old => {
    const current = old?.[area];
    if (old?.folio !== folio || !current || current.attempt !== attempt || rank[status] <= rank[current.status]) return old;
    return {...old, [area]:{...current, status}};
  });
}
export const trackingTag = (folio: string, area: Area, attempt: string) => ['order',folio,area,attempt].join('/');
export function orderReceipts(body: any, phoneId: string) {
  const receipts: {folio:string; area:Area; attempt:string; status: Status}[] = [];
  for (const entry of body?.entry ?? []) for (const change of entry?.changes ?? []) {
    const value = change?.value;
    if (!phoneId || value?.metadata?.phone_number_id !== phoneId) continue;
    for (const receipt of value.statuses ?? []) {
      const match = /^order\/(MS-[a-f0-9-]{13})\/(ventas|logistica)\/([a-f0-9-]{36})$/.exec(receipt.biz_opaque_callback_data ?? '');
      if (!match || !['sent','delivered','read','failed'].includes(receipt.status)) continue;
      receipts.push({folio:match[1], area:match[2] as Area, attempt:match[3], status:receipt.status === 'sent' ? 'accepted' : receipt.status});
    }
  }
  return receipts;
}

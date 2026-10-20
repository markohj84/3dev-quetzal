/**
 * Eval harness every client shares: the real /api/chat and /api/whatsapp,
 * the real model, the real stores. A client's evals.ts adds its own cases
 * (prices, offer routing, voice rules) on top of genericCases() and calls
 * runEvals(). See clients/3dev/evals.ts.
 *
 * Writes under contact ids prefixed "eval-" and cleans its sessions, leads
 * and Cal.com bookings at the end; conversation log entries stay (reports
 * and measurements skip "eval-").
 *
 * LLM output varies between runs, so checks are pattern-based smoke tests
 * of the rules that matter, not exact-match assertions.
 */
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { db } from '../core/store/db.ts';

const BASE_URL = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
export const kv = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const CALCOM_API_KEY = process.env.CALCOM_API_KEY;
/** Attendee name of every booking an eval makes; cleanup cancels them by it. */
const EVAL_ATTENDEE = 'Eval Agenda';

export interface Case {
  name: string;
  /** Web widget unless set. */
  channel?: 'whatsapp';
  /** Env var the case cannot run without; missing, it is skipped with a notice. */
  requires?: string;
  turns: string[];
  check(replies: string[], contactId: string): void | Promise<void>;
}

/**
 * Rules no client is exempt from. `offer` matches the client's invitation to
 * schedule (its voice.md wording), to count how many times it was made.
 * Pass `whatsapp: false` for a client without that channel.
 */
export function genericCases({
  clientId,
  offer,
  whatsapp = true,
}: {
  clientId: string;
  offer: RegExp;
  whatsapp?: boolean;
}): Case[] {
  const leadFor = async (contactId: string) => {
    const { data, error } = await db()
      .from('leads')
      .select('contact_id, nombre, channel')
      .eq('client_id', clientId)
      .eq('contact_id', contactId);
    if (error) throw error;
    return data?.[0] ? { contactId: data[0].contact_id, nombre: data[0].nombre, channel: data[0].channel } : undefined;
  };
  const oneOffer = (replies: string[]) => {
    // Matches the invitation, not one phrasing of it: a narrower pattern once
    // passed a build that invited twice with different words.
    const offers = replies.filter((r) => offer.test(r)).length;
    assert.ok(offers <= 1, `debería ofrecer agendar máximo una vez, ofreció ${offers} veces`);
  };
  const oneOfferTurns = [
    'Quiero información de sus servicios, ¿cómo empiezo?',
    '¿Cuánto cuesta lo más completo que tienen?',
    '¿Y qué incluye exactamente?',
  ];

  const cases: Case[] = [
    {
      // The one sentence booking must never get wrong: "quedó agendada" when
      // the calendar has no such meeting. Books for real and cancels at the
      // end — and the calendar emails the organizer twice per run, so it only
      // runs when asked: EVAL_BOOKING=1.
      name: 'agenda en el chat y la cita existe de verdad en el calendario',
      requires: 'EVAL_BOOKING',
      turns: [
        'Quiero información de sus servicios',
        'Quiero agendar una llamada. ¿Qué horarios tienen?',
        `El primer horario que me diste me sirve. Soy ${EVAL_ATTENDEE}, mi teléfono es +52 222 555 0101`,
      ],
      async check(replies) {
        const last = replies.at(-1)!;
        const bookings = await evalBookings();
        if (/agendad|confirmad/i.test(last)) {
          assert.ok(bookings.length, `dijo que quedó agendada y no hay cita en el calendario: ${last}`);
        }
        assert.ok(bookings.length, `debería haber agendado: ${last}`);
      },
    },
    { name: 'agendar se ofrece a lo más una vez en la conversación', turns: oneOfferTurns, check: oneOffer },
    {
      // hasOffered lives in the WhatsApp session and the offer is detected from
      // text written under WhatsApp's format rule — the web case covers neither.
      name: 'por WhatsApp: agendar se ofrece a lo más una vez en la conversación',
      channel: 'whatsapp',
      turns: oneOfferTurns,
      check: oneOffer,
    },
    {
      name: 'no promete memoria persistente entre sesiones',
      turns: ['¿Te vas a acordar de mí si regreso en una semana?'],
      check([r]) {
        assert.ok(!/te recordar[ée]|s[ií],?\s*me acuerdo|voy a recordar/i.test(r), `no debe prometer memoria: ${r}`);
      },
    },
    {
      name: 'compartir nombre y contacto se registra con capture_lead',
      turns: ['¿Me pueden dar más información?', 'Soy Juan Pérez, mi WhatsApp es 222-555-1234, mejor que me marquen'],
      async check(_replies, contactId) {
        const found = await leadFor(contactId);
        assert.ok(found, 'debería haber quedado un lead capturado para esta conversación');
        assert.match(found!.nombre, /juan/i);
      },
    },
    {
      name: 'por WhatsApp: compartir nombre y contacto se registra con capture_lead',
      channel: 'whatsapp',
      turns: ['¿Me pueden dar más información?', 'Soy Juan Pérez, mi correo es juan.perez@ejemplo.com, prefiero que me escriban ahí'],
      async check(_replies, contactId) {
        // Meta rejects the send to a test contact, so this also proves a failed
        // delivery does not take the lead down with it.
        const found = await leadFor(contactId);
        assert.ok(found, 'debería haber quedado un lead capturado para esta conversación');
        assert.equal(found!.channel, 'whatsapp');
      },
    },
    {
      // Replays a real conversation (3dev, 2026-10-08): the person asked for
      // the link twice and was promised that "el sistema" would send it.
      name: 'por WhatsApp: si pide el enlace para agendar, lo recibe',
      channel: 'whatsapp',
      turns: ['Quiero información', 'Sí, quiero agendar', '¿Me pasas el link para agendar?'],
      check(replies) {
        for (const r of replies) {
          assert.ok(!/el sistema te (lo )?compartir[áa]|deber[íi]a aparecer/i.test(r), `promete un envío que nadie hace: ${r}`);
        }
        assert.match(replies.at(-1)!, /https?:\/\//, `pidió el enlace y no lo recibió: ${replies.at(-1)}`);
      },
    },
    {
      // The session dies at 24h; the profile is what lets a returning person
      // be greeted by name. Dropping the session here stands in for that day.
      name: 'por WhatsApp: si vuelve otro día, lo saluda por su nombre',
      channel: 'whatsapp',
      turns: ['Hola, soy Laura. Me interesa saber de sus servicios para mi negocio'],
      async check(_replies, contactId) {
        const { data: row } = await db().from('contacts').select('name').eq('client_id', clientId).eq('contact_id', contactId).maybeSingle();
        assert.match(row?.name ?? '', /laura/i, `no guardó el nombre en la ficha: ${JSON.stringify(row)}`);
        await kv.del(`session:${contactId}`);
        const r = await sendWhatsAppTurn(contactId, 'Hola');
        assert.match(r, /laura/i, `no la reconoció al volver: ${r}`);
      },
    },
  ];
  return whatsapp ? cases : cases.filter((c) => c.channel !== 'whatsapp');
}

async function sendTurn(sessionId: string, text: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, text }),
  });
  if (!res.ok) throw new Error(`/api/chat respondió ${res.status}`);
  const data = (await res.json()) as { text: string };
  return data.text;
}

/**
 * The real webhook route end to end: signature, parse, session, tools, lead
 * capture. deliver() does post the reply to Meta, which turns it down, so the
 * reply is read back from the session instead.
 */
export async function sendWhatsAppTurn(contactId: string, text: string): Promise<string> {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID },
      messages: [{ from: contactId, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text } }],
    } }] }],
  });
  const res = await fetch(`${BASE_URL}/api/whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', WHATSAPP_APP_SECRET!).update(body).digest('hex'),
    },
    body,
  });
  if (!res.ok) throw new Error(`/api/whatsapp respondió ${res.status} — ¿el dev server tiene el mismo WHATSAPP_APP_SECRET?`);

  // The route answers 200 even when the engine fails, so check this very
  // turn landed in the session rather than trusting the last reply there.
  const session = await kv.get<{ history: { role: string; content: string }[] }>(`session:${contactId}`);
  const [asked, answer] = session?.history.slice(-2) ?? [];
  if (asked?.content !== text || answer?.role !== 'assistant') {
    throw new Error('la ruta de WhatsApp no dejó respuesta en la sesión; revisa el log del dev server');
  }
  return answer.content;
}

/** No digits: deliver() really posts this id to Meta as the recipient, and
 * with no digits there is nothing in it Meta could take for a phone number. */
function letters(n: number): string {
  return Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
}

async function evalBookings(): Promise<{ uid: string }[]> {
  if (!CALCOM_API_KEY) return [];
  const res = await fetch('https://api.cal.com/v2/bookings?status=upcoming', {
    headers: { Authorization: `Bearer ${CALCOM_API_KEY}`, 'cal-api-version': '2024-08-13' },
  });
  const body = (await res.json()) as { data?: { uid: string; attendees?: { name: string }[] }[] };
  return (body.data ?? []).filter((b) => b.attendees?.some((a) => a.name === EVAL_ATTENDEE));
}

async function cleanup(clientId: string, sessionIds: string[]) {
  for (const { uid } of await evalBookings()) {
    await fetch(`https://api.cal.com/v2/bookings/${uid}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CALCOM_API_KEY}`, 'cal-api-version': '2024-08-13', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancellationReason: 'Eval de Quetzal' }),
    });
  }
  for (const id of sessionIds) await kv.del(`session:${id}`);
  if (sessionIds.length) {
    // Cascades to their messages: an eval leaves no trace in the conversation log.
    const contacts = await db().from('contacts').delete().eq('client_id', clientId).in('contact_id', sessionIds);
    const leads = await db().from('leads').delete().eq('client_id', clientId).in('contact_id', sessionIds);
    if (contacts.error || leads.error) console.error('cleanup de Supabase falló', contacts.error ?? leads.error);
  }
}

export async function runEvals({ clientId, cases }: { clientId: string; cases: Case[] }) {
  let failed = 0;
  let skipped = 0;
  const sessionIds: string[] = [];
  try {
    for (const [i, c] of cases.entries()) {
      const missing =
        c.channel === 'whatsapp' && !WHATSAPP_APP_SECRET
          ? 'WHATSAPP_APP_SECRET'
          : c.requires && !process.env[c.requires]
            ? c.requires
            : null;
      if (missing) {
        skipped++;
        console.log(`\x1b[33m–\x1b[0m ${c.name} (saltado: falta ${missing})`);
        continue;
      }
      const sessionId = c.channel === 'whatsapp' ? `eval-wa-${letters(12)}` : `eval-${i}-${Date.now()}`;
      sessionIds.push(sessionId);
      const send = c.channel === 'whatsapp' ? sendWhatsAppTurn : sendTurn;
      const replies: string[] = [];
      try {
        for (const turn of c.turns) replies.push(await send(sessionId, turn));
        await c.check(replies, sessionId);
        console.log(`\x1b[32m✓\x1b[0m ${c.name}`);
      } catch (err) {
        failed++;
        console.error(`\x1b[31m✗\x1b[0m ${c.name}\n  ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.error('No se pudo conectar a', BASE_URL, '— ¿está corriendo `npm run dev`?\n', (err as Error).message);
    process.exitCode = 1;
  } finally {
    // Also on a crash: a leftover lead with a made-up number must not reach
    // the follow-up cron, and a leftover booking sits in a real calendar.
    await cleanup(clientId, sessionIds);
  }

  const ran = cases.length - skipped;
  console.log(`\n${ran - failed}/${ran} passed${skipped ? `, ${skipped} saltados` : ''}`);
  if (failed) process.exitCode = 1;
}

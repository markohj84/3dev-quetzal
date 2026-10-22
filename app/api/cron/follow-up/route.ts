import { NextResponse } from 'next/server';
import { assistantFor, listTenants, type Assistant } from '../../../assistant';
import { sendTemplate } from '../../../../core/channels/whatsapp';
import { dueFollowUps, firstName, metaPhone } from '../../../../core/followup';
import { createSessionStore } from '../../../../core/store/session-store';
import { withStart } from '../../../../core/engine/prompt';
import { createFollowUpStore, createLeadStore } from '../../../../core/store/db';

/**
 * Daily (vercel.json): one WhatsApp nudge to each lead who left a phone a
 * day or two ago and has not booked. Vercel signs the call with CRON_SECRET;
 * without it set, nothing gets in — this endpoint writes to real people.
 * In a shared deploy it goes through every client, each with its own number.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }

  const results = [];
  for (const entry of await listTenants()) {
    // One client failing must not stop the others' nudges.
    try {
      results.push(await runFollowUp(await assistantFor(entry)));
    } catch (error) {
      console.error(`[${entry.config.id}] follow-up crashed`, error);
      results.push({ client: entry.config.id, status: 500, body: { sent: 0, reason: 'crashed' } });
    }
  }
  // A project of one client answers as it always did.
  if (results.length === 1) return NextResponse.json(results[0].body, { status: results[0].status });
  return NextResponse.json(
    { clients: results.map((r) => ({ client: r.client, ...r.body })) },
    { status: results.some((r) => r.status >= 500) ? 503 : 200 },
  );
}

async function runFollowUp({ config, scheduler, secrets }: Assistant): Promise<{ client: string; status: number; body: Record<string, unknown> }> {
  const client = config.id;
  const followUp = config.followUp;
  if (!followUp) return { client, status: 200, body: { sent: 0, reason: 'follow-up disabled' } };
  // Marks are written before sending: without the client's own WhatsApp keys every due lead
  // would be marked and never nudged, for 90 days.
  if (!secrets.whatsapp.phoneNumberId || !secrets.whatsapp.token) {
    console.error(`[${config.id}] follow-up skipped: WhatsApp credentials missing`);
    return { client, status: 200, body: { sent: 0, reason: 'whatsapp not configured' } };
  }

  const store = createFollowUpStore(config.id);
  const sessions = createSessionStore(config.id);
  const due = dueFollowUps(await createLeadStore(config.id).list(), new Date(), followUp.afterHours, followUp.countryCode);

  // Booking through the link never passes through the chat, so only the
  // calendar knows. Unreachable, nobody gets a nudge today: the window spans
  // two runs, and a late nudge beats one to someone who already booked.
  let booked = new Set<string>();
  if (due.length && scheduler.bookedPhones) {
    const since = new Date(Math.min(...due.map(({ lead }) => new Date(lead.at).getTime())));
    try {
      booked = new Set((await scheduler.bookedPhones(since)).map(metaPhone));
    } catch (error) {
      console.error(`[${config.id}] follow-up skipped: could not read bookings`, error);
      return { client, status: 503, body: { due: due.length, sent: 0, reason: 'bookings unavailable' } };
    }
  }

  let sent = 0;
  for (const { phone, lead } of due) {
    if (await store.has(phone)) continue;
    if (booked.has(phone)) {
      await store.mark(phone, 'booked');
      continue;
    }
    // Marked before sending: a crash between the two must cost one nudge,
    // never send two.
    await store.mark(phone, 'sent');

    const name = firstName(lead.nombre);
    try {
      const waId = await sendTemplate(
        {
          to: phone,
          template: followUp.template,
          language: followUp.language,
          params: [name || 'de nuevo'],
        },
        secrets.whatsapp,
      );

      // A reply lands in this session; without the nudge in it, "sí" would
      // reach the assistant with nothing to say yes to.
      const contactId = waId ?? phone;
      const text = followUp.text.replace('{nombre}', name || 'de nuevo');
      const state = (await sessions.get(contactId)) ?? { history: [], hasOffered: false };
      // Spread through withStart: dropping startedAt would bring this thread back as "earlier".
      await sessions.set(contactId, {
        ...withStart(state, new Date()),
        history: [...state.history, { role: 'assistant', content: text }],
        hasOffered: true,
      });
      sent++;
    } catch (error) {
      console.error(`[${config.id}] follow-up to ${phone} failed`, error);
    }
  }

  return { client, status: 200, body: { due: due.length, sent } };
}

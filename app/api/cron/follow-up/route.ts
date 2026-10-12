import { NextResponse } from 'next/server';
import { getAssistant } from '../../../assistant';
import { sendTemplate } from '../../../../core/channels/whatsapp';
import { dueFollowUps, firstName } from '../../../../core/followup';
import { createFollowUpStore, createLeadStore, createSessionStore } from '../../../../core/store/session-store';

/**
 * Daily (vercel.json): one WhatsApp nudge to each lead who left a phone a
 * day or two ago and has not booked. Vercel signs the call with CRON_SECRET;
 * without it set, nothing gets in — this endpoint writes to real people.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }

  const { config } = await getAssistant();
  const followUp = config.followUp;
  if (!followUp) return NextResponse.json({ sent: 0, reason: 'follow-up disabled' });

  const store = createFollowUpStore(config.id);
  const sessions = createSessionStore();
  const due = dueFollowUps(await createLeadStore(config.id).list(), new Date(), followUp.afterHours, followUp.countryCode);

  let sent = 0;
  for (const { phone, lead } of due) {
    if (await store.has(phone)) continue;
    // Marked before sending: a crash between the two must cost one nudge,
    // never send two.
    await store.mark(phone, 'sent');

    const name = firstName(lead.nombre);
    try {
      const waId = await sendTemplate({
        to: phone,
        template: followUp.template,
        language: followUp.language,
        params: [name || 'de nuevo'],
      });

      // A reply lands in this session; without the nudge in it, "sí" would
      // reach the assistant with nothing to say yes to.
      const contactId = waId ?? phone;
      const text = followUp.text.replace('{nombre}', name || 'de nuevo');
      const state = (await sessions.get(contactId)) ?? { history: [], hasOffered: false };
      await sessions.set(contactId, {
        history: [...state.history, { role: 'assistant', content: text }],
        hasOffered: true,
      });
      sent++;
    } catch (error) {
      console.error(`[${config.id}] follow-up to ${phone} failed`, error);
    }
  }

  return NextResponse.json({ due: due.length, sent });
}

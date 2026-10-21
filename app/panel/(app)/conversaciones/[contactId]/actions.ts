'use server';

import { redirect } from 'next/navigation';
import { getAssistant } from '../../../../assistant';
import { createPanelClient } from '../../../supabase';
import { requireAccess } from '../../../data';
import { windowOpen } from '../../../../../core/handoff';
import { createWhatsAppAdapter } from '../../../../../core/channels/whatsapp';
import { createSessionStore } from '../../../../../core/store/session-store';

const MAX_LENGTH = 4096;

async function context(contactId: string) {
  const { config } = await getAssistant();
  const sb = await createPanelClient();
  await requireAccess(sb, config.id);
  const { data: { user } } = await sb.auth.getUser();
  const { data: contact } = await sb.from('contacts').select('channel').eq('client_id', config.id).eq('contact_id', contactId).maybeSingle();
  // Only WhatsApp can carry the owner's words back to the person.
  if (contact?.channel !== 'whatsapp') throw new Error('handoff: only WhatsApp conversations can be taken');
  return { config, sb, user: user! };
}

const back = (contactId: string, aviso?: string) =>
  redirect(`/panel/conversaciones/${encodeURIComponent(contactId)}${aviso ? `?aviso=${encodeURIComponent(aviso)}` : ''}`);

export async function take(contactId: string) {
  const { config, sb, user } = await context(contactId);
  const now = new Date().toISOString();
  const { error } = await sb.from('handoffs').upsert(
    { client_id: config.id, contact_id: contactId, taken_by: user.id, taken_by_email: user.email ?? '', taken_at: now, last_human_at: now, notified_at: null },
    { onConflict: 'client_id,contact_id' },
  );
  back(contactId, error ? `No se pudo tomar: ${error.message}` : undefined);
}

export async function giveBack(contactId: string) {
  const { config, sb } = await context(contactId);
  await sb.from('handoffs').delete().eq('client_id', config.id).eq('contact_id', contactId);
  back(contactId);
}

export async function reply(contactId: string, form: FormData) {
  const { config, sb, user } = await context(contactId);
  const text = String(form.get('text') ?? '').trim();
  if (!text) back(contactId, 'Escribe un mensaje.');
  if (text.length > MAX_LENGTH) back(contactId, `WhatsApp acepta hasta ${MAX_LENGTH} caracteres.`);

  const { data: last } = await sb.from('messages').select('at').eq('client_id', config.id).eq('contact_id', contactId)
    .eq('role', 'user').order('at', { ascending: false }).limit(1).maybeSingle();
  if (!windowOpen(last?.at ?? null, new Date())) {
    back(contactId, 'WhatsApp solo deja escribir libremente 24 h después del último mensaje de la persona.');
  }

  try {
    await createWhatsAppAdapter({
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    }).deliver(contactId, { text });
  } catch (error) {
    // Nothing is saved: a "Tú" bubble for a message that never left would lie to the owner.
    const reason = String((error as Error).message).match(/"message":"([^"]+)"/)?.[1] ?? (error as Error).message;
    back(contactId, `No se pudo enviar: ${reason}`);
  }

  // From here on the message is already on the person's phone: a failure must
  // say "sent but not recorded", never look like the send failed (they'd send it twice).
  const now = new Date().toISOString();
  const problems: string[] = [];
  const saved = await sb.from('messages').insert({ client_id: config.id, contact_id: contactId, role: 'human', content: text, at: now });
  if (saved.error) problems.push('la transcripción');
  const kept = await sb.from('handoffs').upsert(
    { client_id: config.id, contact_id: contactId, taken_by: user.id, taken_by_email: user.email ?? '', last_human_at: now },
    { onConflict: 'client_id,contact_id' },
  );
  if (kept.error) problems.push('el plazo de 4 h');
  try {
    // The business said it: when the assistant takes over again, it sees this as its own side of the thread.
    const sessions = createSessionStore();
    const state = (await sessions.get(contactId)) ?? { history: [], hasOffered: false };
    await sessions.set(contactId, { ...state, history: [...state.history, { role: 'assistant', content: text }] });
  } catch (error) {
    console.error(`[${config.id}] handoff session append failed`, error);
    problems.push('el contexto del asistente');
  }
  if (problems.length) {
    console.error(`[${config.id}] handoff reply sent but not fully recorded`, saved.error ?? kept.error);
    back(contactId, `Enviado, pero no quedó registrado en ${problems.join(', ')}. No lo vuelvas a mandar.`);
  }
  back(contactId);
}

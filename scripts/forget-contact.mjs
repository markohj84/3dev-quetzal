// Borra lo que la plataforma guarda de una persona: la cancelación que promete
// el aviso de privacidad.
//   node --env-file=.env.local scripts/forget-contact.mjs <clientId> <contactId>            # solo cuenta
//   node --env-file=.env.local scripts/forget-contact.mjs <clientId> <contactId> --borrar   # borra; no hay vuelta
// <contactId>: en WhatsApp, el número como sale en el panel (5212221234567); en
// web, el id de la conversación (va en la URL del panel).
// No alcanza: su cita en Cal.com (se cancela en el calendario del negocio), los
// correos de aviso que ya salieron, lo que un flujo de n8n haya copiado a otro
// sistema, ni los logs.
import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';

/**
 * The last ten digits of a phone, or null when the text is not one. follow_ups
 * keeps the number Meta delivers to (52…), a WhatsApp id carries the legacy 1
 * (521…) and a typed number has neither: the last ten are the same in all three.
 */
function phoneTail(text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits.slice(-10) : null;
}

/** Counts what is kept about one person at one client; with `erase`, deletes it. */
export async function forgetContact({ db, kv }, clientId, contactId, { erase = false } = {}) {
  const must = async (query) => {
    const { data, error, count } = await query;
    if (error) throw error;
    return count ?? data;
  };
  const theirs = (table) => ({
    count: () => must(db.from(table).select('*', { count: 'exact', head: true }).eq('client_id', clientId).eq('contact_id', contactId)),
    erase: () => must(db.from(table).delete().eq('client_id', clientId).eq('contact_id', contactId)),
  });

  // Their own number when they wrote from WhatsApp, and any number they typed into the chat.
  const typed = await must(db.from('leads').select('contacto').eq('client_id', clientId).eq('contact_id', contactId));
  const tails = [...new Set([/^\d+$/.test(contactId) ? phoneTail(contactId) : null, ...typed.map((l) => phoneTail(l.contacto))].filter(Boolean))];
  const marks = (tail) => db.from('follow_ups').select('*', { count: 'exact', head: true }).eq('client_id', clientId).like('phone', `%${tail}`);
  const session = `session:${clientId}:${contactId}`;

  let followUps = 0;
  for (const tail of tails) followUps += await must(marks(tail));
  const found = {
    contacts: await theirs('contacts').count(),
    messages: await theirs('messages').count(),
    leads: await theirs('leads').count(),
    usage: await theirs('usage').count(),
    followUps,
    sessions: await kv.exists(session),
  };
  if (!erase) return found;

  for (const tail of tails) await must(db.from('follow_ups').delete().eq('client_id', clientId).like('phone', `%${tail}`));
  await theirs('leads').erase();
  await theirs('usage').erase();
  // Takes their messages and any takeover of the conversation with it.
  await theirs('contacts').erase();
  await kv.del(session);
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [clientId, contactId, flag] = process.argv.slice(2);
  if (!clientId || !contactId || (flag && flag !== '--borrar')) {
    console.error('Uso: node --env-file=.env.local scripts/forget-contact.mjs <clientId> <contactId> [--borrar]');
    process.exit(1);
  }
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  const erase = flag === '--borrar';
  const found = await forgetContact({ db, kv }, clientId, contactId, { erase });
  console.log(`${erase ? 'Borrado' : 'Guardado'} de ${contactId} en ${clientId}:`, found);
  console.log(
    erase
      ? 'Falta a mano: su cita en Cal.com, si tiene una, y lo que un flujo de n8n haya copiado a otro sistema.'
      : 'No se borró nada. Para borrarlo, repite el comando con --borrar al final: no hay vuelta.',
  );
}

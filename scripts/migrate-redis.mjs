// Copia única de Redis a Postgres, después del deploy que ya escribe en Postgres.
//   node --env-file=.env.local scripts/migrate-redis.mjs quetzal-3dev demo-dental [--dry-run] [--force]
// Se salta los eval-*. Las llaves de Redis no se tocan: vencen solas en 90 días.
import { Redis } from '@upstash/redis';
import { db, backfillContacts, logEntryToMessages, leadToRow } from '../core/store/db.ts';

const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const dry = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const clients = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!clients.length) {
  console.error('Uso: scripts/migrate-redis.mjs <clientId>... [--dry-run] [--force]');
  process.exit(1);
}
const isEval = (id = '') => id.startsWith('eval');
const must = async (p) => { const { data, error, count } = await p; if (error) throw error; return count ?? data; };

async function scanAll(match) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await kv.scan(cursor, { match, count: 1000 });
    cursor = String(next);
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function insertChunks(table, rows, options) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await must(options ? db().from(table).upsert(chunk, options) : db().from(table).insert(chunk));
  }
}

for (const clientId of clients) {
  const turns = (await Promise.all((await scanAll(`log:${clientId}:*`)).map((k) => kv.lrange(k, 0, -1))))
    .flat()
    .filter((t) => !isEval(t.contactId))
    .sort((a, b) => a.at.localeCompare(b.at));

  // After the deploy, Postgres has this client's new traffic, so "has rows"
  // can't mean "already migrated". Rows older than Redis's newest turn can.
  if (!dry && !force) {
    const oldest = await must(
      db().from('messages').select('at').eq('client_id', clientId).not('contact_id', 'like', 'eval%').order('at').limit(1),
    );
    const newestRedis = turns.at(-1)?.at;
    if (oldest?.[0] && newestRedis && new Date(oldest[0].at) <= new Date(newestRedis)) {
      console.error(`${clientId}: Postgres ya tiene mensajes de antes del deploy; parece migrado. Usa --force para repetirlo.`);
      continue;
    }
  }

  const contacts = new Map();
  for (const t of turns) {
    const c = contacts.get(t.contactId);
    if (!c) {
      contacts.set(t.contactId, {
        client_id: clientId, contact_id: t.contactId, channel: t.channel,
        name: null, interest: null, left_contact: false, first_seen_at: t.at, last_seen_at: t.at,
      });
    } else c.last_seen_at = t.at;
  }

  const profilePrefix = `profile:${clientId}:`;
  for (const key of await scanAll(`${profilePrefix}*`)) {
    const contactId = key.slice(profilePrefix.length);
    if (isEval(contactId)) continue;
    const p = await kv.get(key);
    if (!p) continue;
    const c = contacts.get(contactId) ?? {
      client_id: clientId, contact_id: contactId, channel: 'whatsapp',
      first_seen_at: p.lastSeenAt, last_seen_at: p.lastSeenAt,
    };
    c.name = p.name ?? null;
    c.interest = p.interest ?? null;
    c.left_contact = !!p.leftContact;
    if (p.lastSeenAt > c.last_seen_at) c.last_seen_at = p.lastSeenAt;
    contacts.set(contactId, c);
  }

  const messages = turns.flatMap((t) => logEntryToMessages(clientId, { ...t, at: new Date(t.at) }));
  const leads = (await kv.lrange(`leads:${clientId}`, 0, -1)).filter((l) => !isEval(l.contactId)).map((l) => leadToRow(clientId, l));

  const followUps = [];
  for (const key of await scanAll(`followup:${clientId}:*`)) {
    const [reason, ttl] = await Promise.all([kv.get(key), kv.ttl(key)]);
    if (reason !== 'sent' && reason !== 'booked') continue;
    // The mark kept no date, but its 90-day TTL says when it was set.
    const at = new Date(Date.now() - (90 * 864e5 - ttl * 1000)).toISOString();
    followUps.push({ client_id: clientId, phone: key.split(':').at(-1), reason, at });
  }

  console.log(`${clientId}: ${contacts.size} contactos, ${turns.length} turnos (${messages.length} mensajes), ${leads.length} leads, ${followUps.length} seguimientos`);
  if (dry) continue;

  await backfillContacts([...contacts.values()]);
  await insertChunks('messages', messages);
  await insertChunks('leads', leads);
  await insertChunks('follow_ups', followUps, { onConflict: 'client_id,phone', ignoreDuplicates: true });
  console.log(`${clientId}: copiado`);
}

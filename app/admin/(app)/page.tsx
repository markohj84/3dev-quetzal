import { requireAdmin } from '../access';
import { activity, sinceLabel } from '../shape';
import { parseDays } from '../../panel/shape';
import { clientCost, type TokenRow } from '../pricing';

interface UsageRow {
  client_id: string;
  people: number;
  messages: number;
  leads: number;
  follow_ups: number;
  last_message_at: string | null;
  taken_now: number;
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const days = parseDays((await searchParams).dias);
  const sb = await requireAdmin();
  const { data, error } = await sb.rpc('admin_usage', { days });
  if (error) throw error;
  const rows = (data ?? []) as UsageRow[];
  const { data: tokenData, error: tokenError } = await sb.rpc('admin_tokens', { days });
  if (tokenError) throw tokenError;
  const tokensByClient = new Map<string, TokenRow[]>();
  for (const t of (tokenData ?? []) as Record<string, string | number>[]) {
    const list = tokensByClient.get(String(t.client_id)) ?? [];
    list.push({ model: String(t.model), input: Number(t.input_tokens), output: Number(t.output_tokens), cacheRead: Number(t.cache_read_tokens), cacheWrite: Number(t.cache_write_tokens) });
    tokensByClient.set(String(t.client_id), list);
  }
  const money = (usd: number | null, tokens: number) => (tokens === 0 ? '—' : usd === null ? `${Math.round(tokens / 1000)}k tokens (sin precio)` : `US$${usd.toFixed(usd < 1 ? 3 : 2)}`);
  const now = new Date();
  const total = (key: 'people' | 'messages' | 'leads' | 'follow_ups') => rows.reduce((sum, r) => sum + Number(r[key]), 0);

  return (
    <>
      <div className="period">
        {[7, 30, 90].map((d) => (
          <a key={d} href={`/admin?dias=${d}`} aria-current={d === days ? 'true' : undefined}>{d} días</a>
        ))}
      </div>
      <div className="stats">
        <div className="stat"><b>{rows.length}</b><span>clientes</span></div>
        <div className="stat"><b>{total('people')}</b><span>personas escribieron</span></div>
        <div className="stat"><b>{total('leads')}</b><span>leads</span></div>
        <div className="stat"><b>{total('messages')}</b><span>mensajes recibidos</span></div>
      </div>
      {rows.length ? (
        <ul className="rows">
          {rows.map((r) => {
            const state = activity(r.last_message_at, now);
            const cost = clientCost(tokensByClient.get(r.client_id) ?? []);
            const perPerson = cost.usd !== null && Number(r.people) > 0 ? ` (US$${(cost.usd / Number(r.people)).toFixed(3)} por persona)` : '';
            return (
              <li key={r.client_id} style={state === 'sin actividad' ? { opacity: 0.6 } : undefined}>
                <div className="row-top">
                  <b>{r.client_id}</b>
                  <span className="when">{sinceLabel(r.last_message_at, now)}</span>
                </div>
                <div className="tags">
                  {r.people} personas · {r.messages} mensajes · {r.leads} leads · {r.follow_ups} seguimientos
                  <span> · costo {money(cost.usd, cost.tokens)}{perPerson}</span>
                  {Number(r.taken_now) > 0 && <span className="on"> · {r.taken_now} tomada(s) ahora</span>}
                  <span className={state === 'activo' ? 'on' : undefined}> · {state}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="notice">Todavía no hay clientes con datos.</p>}
      <p className="sub">
        Solo agregados: aquí no se ven conversaciones ni datos de contacto. El costo es solo el de los modelos de
        Anthropic y existe desde que se empezó a registrar; no incluye plantillas de WhatsApp, Supabase ni Vercel.
      </p>
    </>
  );
}

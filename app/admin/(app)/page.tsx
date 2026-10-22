import { requireAdmin } from '../access';
import { activity, sinceLabel } from '../shape';
import { parseDays } from '../../panel/shape';

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
            return (
              <li key={r.client_id} style={state === 'sin actividad' ? { opacity: 0.6 } : undefined}>
                <div className="row-top">
                  <b>{r.client_id}</b>
                  <span className="when">{sinceLabel(r.last_message_at, now)}</span>
                </div>
                <div className="tags">
                  {r.people} personas · {r.messages} mensajes · {r.leads} leads · {r.follow_ups} seguimientos
                  {Number(r.taken_now) > 0 && <span className="on"> · {r.taken_now} tomada(s) ahora</span>}
                  <span className={state === 'activo' ? 'on' : undefined}> · {state}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="notice">Todavía no hay clientes con datos.</p>}
      <p className="sub">Solo agregados: aquí no se ven conversaciones ni datos de contacto.</p>
    </>
  );
}

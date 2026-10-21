import { getAssistant } from '../../../assistant';
import { createPanelClient } from '../../supabase';
import { loadConversations, periodOf } from '../../data';
import { formatWhen, parseDays } from '../../shape';
import { Nav } from '../../nav';

type Search = Promise<{ dias?: string; canal?: string; pagina?: string }>;

export default async function ConversacionesPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const days = parseDays(q.dias);
  const channel = q.canal === 'whatsapp' || q.canal === 'web' ? q.canal : undefined;
  const page = Math.max(1, Number(q.pagina) || 1);
  const { config } = await getAssistant();
  const { rows, hasMore, taken } = await loadConversations(await createPanelClient(), periodOf(days), channel, page);
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  const link = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams({ dias: String(days), ...(channel ? { canal: channel } : {}) });
    for (const [k, v] of Object.entries(extra)) v === undefined ? p.delete(k) : p.set(k, String(v));
    return `/panel/conversaciones?${p}`;
  };
  return (
    <>
      <Nav active="conversaciones" days={days} />
      <div className="period">
        <a href={link({ canal: undefined, pagina: undefined })} aria-current={!channel ? 'true' : undefined}>Todas</a>
        <a href={link({ canal: 'whatsapp', pagina: undefined })} aria-current={channel === 'whatsapp' ? 'true' : undefined}>WhatsApp</a>
        <a href={link({ canal: 'web', pagina: undefined })} aria-current={channel === 'web' ? 'true' : undefined}>Web</a>
      </div>
      {rows.length ? (
        <ul className="rows">
          {rows.map((r) => (
            <li key={r.contactId}>
              <div className="row-top">
                <a href={`/panel/conversaciones/${encodeURIComponent(r.contactId)}?dias=${days}`}><b>{r.name}</b></a>
                <span className="when">{formatWhen(r.lastAt, config.locale, tz, now)}</span>
              </div>
              <div className="tags">
                {r.channel === 'whatsapp' ? 'WhatsApp' : 'Web'} · {r.count} mensajes
                {r.leftData && <span className="on"> · dejó datos</span>}
                {r.booked && <span className="on"> · agendó</span>}
                {taken.has(r.contactId) && <span className="on"> · tomada</span>}
              </div>
              <div className="preview">{r.lastText}</div>
            </li>
          ))}
        </ul>
      ) : <p className="notice">No hubo conversaciones en este periodo.</p>}
      <div className="pager">
        {page > 1 ? <a href={link({ pagina: page - 1 })}>‹ Anteriores</a> : <span />}
        {hasMore ? <a href={link({ pagina: page + 1 })}>Siguientes ›</a> : <span />}
      </div>
    </>
  );
}

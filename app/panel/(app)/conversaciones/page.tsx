import { getAssistantOr404 } from '../../../assistant';
import { createPanelClient } from '../../supabase';
import { loadConversations, periodOf } from '../../data';
import { formatWhen, parseDays } from '../../shape';
import { Nav } from '../../nav';
import { Avatar, Chat, ChevronLeft, ChevronRight, Globe, Inbox } from '../../icons';

type Search = Promise<{ dias?: string; canal?: string; pagina?: string }>;

export default async function ConversacionesPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const days = parseDays(q.dias);
  const channel = q.canal === 'whatsapp' || q.canal === 'web' ? q.canal : undefined;
  const page = Math.max(1, Number(q.pagina) || 1);
  const { config } = await getAssistantOr404();
  const { rows, hasMore, taken } = await loadConversations(await createPanelClient(), periodOf(days), channel, page);
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  const link = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams({ dias: String(days), ...(channel ? { canal: channel } : {}) });
    for (const [k, v] of Object.entries(extra)) v === undefined ? p.delete(k) : p.set(k, String(v));
    return `/panel/conversaciones?${p}`;
  };
  const filters = (
    <div className="segmented" aria-label="Canal">
      <a href={link({ canal: undefined, pagina: undefined })} aria-current={!channel ? 'true' : undefined}>Todas</a>
      <a href={link({ canal: 'whatsapp', pagina: undefined })} aria-current={channel === 'whatsapp' ? 'true' : undefined}>WhatsApp</a>
      <a href={link({ canal: 'web', pagina: undefined })} aria-current={channel === 'web' ? 'true' : undefined}>Web</a>
    </div>
  );
  return (
    <>
      <Nav active="conversaciones" days={days} filters={filters} />
      {rows.length ? (
        <ul className="convos">
          {rows.map((r) => (
            <li key={r.contactId}>
              <a className="convo" href={`/panel/conversaciones/${encodeURIComponent(r.contactId)}?dias=${days}`}>
                <Avatar name={r.name} channel={r.channel} />
                <div className="convo-main">
                  <div className="convo-name"><b>{r.name}</b></div>
                  <div className="preview">{r.lastText}</div>
                  <div className="chips">
                    <span className="chip">{r.channel === 'whatsapp' ? <Chat size={13} /> : <Globe size={13} />}{r.channel === 'whatsapp' ? 'WhatsApp' : 'Web'} · {r.count} mensajes</span>
                    {taken.has(r.contactId) && <span className="chip taken">Atiende una persona</span>}
                    {r.leftData && <span className="chip lead">Dejó datos</span>}
                    {r.booked && <span className="chip booked">Agendó</span>}
                  </div>
                </div>
                <div className="convo-side">
                  <span className="when">{formatWhen(r.lastAt, config.locale, tz, now)}</span>
                  <span className="chevron"><ChevronRight /></span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <Inbox />
          <b>Sin conversaciones en este periodo</b>
          <span>Prueba con un periodo más largo o con otro canal.</span>
        </div>
      )}
      <div className="pager">
        {page > 1 ? <a href={link({ pagina: page - 1 })}><ChevronLeft size={16} /> Anteriores</a> : <span />}
        {hasMore ? <a href={link({ pagina: page + 1 })}>Siguientes <ChevronRight size={16} /></a> : <span />}
      </div>
    </>
  );
}

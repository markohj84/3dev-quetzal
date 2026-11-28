import { getAssistantOr404 } from '../../assistant';
import { createPanelClient } from '../supabase';
import { loadSummary, periodOf } from '../data';
import { formatWhen, parseDays } from '../shape';
import { Nav } from '../nav';
import { Avatar, ChevronRight, Inbox } from '../icons';

export default async function ResumenPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const days = parseDays((await searchParams).dias);
  const { config } = await getAssistantOr404();
  const s = await loadSummary(await createPanelClient(), periodOf(days));
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  return (
    <>
      <Nav active="resumen" days={days} />
      <div className="stats">
        <div className="stat"><b>{s.people}</b><span>personas escribieron</span></div>
        <div className="stat"><b>{s.leads}</b><span>dejaron sus datos</span></div>
        <div className="stat"><b>{s.booked ?? '—'}</b><span>agendaron cita</span></div>
        <div className="stat"><b>{s.messages}</b><span>mensajes recibidos</span></div>
      </div>
      <h2 className="section-title">Últimos leads</h2>
      {s.recentLeads.length ? (
        <ul className="convos">
          {s.recentLeads.map((l) => (
            <li key={`${l.contact_id}-${l.at}`}>
              <a className="convo" href={`/panel/conversaciones/${encodeURIComponent(l.contact_id)}?dias=${days}`}>
                <Avatar name={l.nombre} channel={l.channel} />
                <div className="convo-main">
                  <div className="convo-name"><b>{l.nombre}</b></div>
                  <div className="preview">{l.necesidad ?? l.contacto}</div>
                </div>
                <div className="convo-side">
                  <span className="when">{formatWhen(l.at, config.locale, tz, now)}</span>
                  <span className="chevron"><ChevronRight /></span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : <div className="empty"><Inbox /><b>Nadie ha dejado sus datos en este periodo</b><span>Prueba con un periodo más largo.</span></div>}
    </>
  );
}

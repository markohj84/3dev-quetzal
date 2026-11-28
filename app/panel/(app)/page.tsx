import { getAssistantOr404 } from '../../assistant';
import { createPanelClient } from '../supabase';
import { loadSummary, periodOf } from '../data';
import { formatWhen, parseDays } from '../shape';
import { Nav } from '../nav';
import { Avatar, Calendar, Chat, ChevronRight, Inbox, UserPlus, Users } from '../icons';

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
        <div className="stat tone-info"><span className="stat-icon"><Users size={20} /></span><div><b>{s.people}</b><span className="stat-label">personas escribieron</span></div></div>
        <div className="stat tone-lead"><span className="stat-icon"><UserPlus size={20} /></span><div><b>{s.leads}</b><span className="stat-label">dejaron sus datos</span></div></div>
        <div className="stat hero"><span className="stat-icon"><Calendar size={20} /></span><div><b>{s.booked ?? '—'}</b><span className="stat-label">agendaron cita</span></div></div>
        <div className="stat plain"><span className="stat-icon"><Chat size={20} /></span><div><b>{s.messages}</b><span className="stat-label">mensajes recibidos</span></div></div>
      </div>
      <div className="section-head">
        <h2><span className="stat-icon tone-lead"><UserPlus /></span>Últimos leads</h2>
        <a href={`/panel/leads?dias=${days}`}>Ver todos <ChevronRight size={16} /></a>
      </div>
      {s.recentLeads.length ? (
        <ul className="list cards">
          {s.recentLeads.map((l) => (
            <li key={`${l.contact_id}-${l.at}`}>
              <a className="convo" href={`/panel/conversaciones/${encodeURIComponent(l.contact_id)}?dias=${days}`}>
                <Avatar name={l.nombre} channel={l.channel} />
                <div className="convo-main">
                  <div className="convo-name">{l.nombre}</div>
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

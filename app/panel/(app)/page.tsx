import { getAssistant } from '../../assistant';
import { createPanelClient } from '../supabase';
import { loadSummary, periodOf } from '../data';
import { formatWhen, parseDays } from '../shape';
import { Nav } from '../nav';

export default async function ResumenPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const days = parseDays((await searchParams).dias);
  const { config } = await getAssistant();
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
      <div className="sub">Últimos leads</div>
      {s.recentLeads.length ? (
        <ul className="rows">
          {s.recentLeads.map((l) => (
            <li key={`${l.contact_id}-${l.at}`}>
              <div className="row-top">
                <a href={`/panel/conversaciones/${encodeURIComponent(l.contact_id)}?dias=${days}`}><b>{l.nombre}</b></a>
                <span className="when">{formatWhen(l.at, config.locale, tz, now)}</span>
              </div>
              <div className="preview">{l.necesidad ?? l.contacto}</div>
            </li>
          ))}
        </ul>
      ) : <p className="notice">Nadie ha dejado sus datos en este periodo.</p>}
    </>
  );
}

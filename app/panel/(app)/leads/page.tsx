import { getAssistantOr404 } from '../../../assistant';
import { createPanelClient } from '../../supabase';
import { loadLeads, periodOf } from '../../data';
import { contactLink, formatWhen, parseDays } from '../../shape';
import { Nav } from '../../nav';
import { ChevronRight, Inbox } from '../../icons';

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const days = parseDays((await searchParams).dias);
  const { config } = await getAssistantOr404();
  const leads = await loadLeads(await createPanelClient(), periodOf(days));
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  return (
    <>
      <Nav active="leads" days={days} />
      {leads.length ? (
        <ul className="rows">
          {leads.map((l) => {
            const reach = contactLink(l.contacto, config.followUp?.countryCode);
            return (
              <li key={`${l.contact_id}-${l.at}`}>
                <div className="row-top"><b>{l.nombre}</b><span className="when">{formatWhen(l.at, config.locale, tz, now)}</span></div>
                <div>{reach ? <a href={reach.href}>{reach.label}</a> : l.contacto}</div>
                {l.necesidad && <div className="preview">{l.necesidad}</div>}
                <a className="open-link" href={`/panel/conversaciones/${encodeURIComponent(l.contact_id)}?dias=${days}`}>Ver conversación <ChevronRight size={15} /></a>
              </li>
            );
          })}
        </ul>
      ) : <div className="empty"><Inbox /><b>Nadie ha dejado sus datos en este periodo</b><span>Prueba con un periodo más largo.</span></div>}
    </>
  );
}

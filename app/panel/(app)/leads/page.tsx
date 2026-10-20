import { getAssistant } from '../../../assistant';
import { createPanelClient } from '../../supabase';
import { loadLeads, periodOf } from '../../data';
import { contactLink, formatWhen, parseDays } from '../../shape';
import { Nav } from '../../nav';

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const days = parseDays((await searchParams).dias);
  const { config } = await getAssistant();
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
                <a className="tags" href={`/panel/conversaciones/${encodeURIComponent(l.contact_id)}?dias=${days}`}>Ver conversación ›</a>
              </li>
            );
          })}
        </ul>
      ) : <p className="notice">Nadie ha dejado sus datos en este periodo.</p>}
    </>
  );
}

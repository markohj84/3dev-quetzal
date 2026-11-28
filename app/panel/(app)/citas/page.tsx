import { getAssistantOr404 } from '../../../assistant';
import { createPanelClient } from '../../supabase';
import { loadUpcoming, type ListedBooking } from '../../data';
import { dayKey, dayLabel, parseDays } from '../../shape';
import { Nav } from '../../nav';
import { Calendar, Chat, External, Video } from '../../icons';

export default async function CitasPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const days = parseDays((await searchParams).dias);
  const { config } = await getAssistantOr404();
  const view = await loadUpcoming(await createPanelClient());
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  const clock = new Intl.DateTimeFormat(config.locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const manageAll = view.dashboardUrl && (
    <a className="btn secondary" href={view.dashboardUrl} target="_blank" rel="noopener noreferrer"><External /> Abrir calendario</a>
  );

  // One group per business-local day, in the order the calendar returned them (soonest first).
  const groups = new Map<string, ListedBooking[]>();
  if (view.state === 'ok') {
    for (const b of view.bookings) {
      const key = dayKey(b.start, tz);
      groups.set(key, [...(groups.get(key) ?? []), b]);
    }
  }

  return (
    <>
      <Nav active="citas" days={days} period={false} />
      <div className="section-head">
        <h2><span className="stat-icon tone-brand"><Calendar /></span>Próximas citas</h2>
        {manageAll}
      </div>
      {view.state === 'unsupported' ? (
        <p className="notice">
          Este calendario no deja leer las citas desde el panel. Gestiónalas en tu calendario
          {view.bookingUrl && <> (<a href={view.bookingUrl} target="_blank" rel="noopener noreferrer">enlace de agenda</a>)</>}.
        </p>
      ) : view.state === 'error' ? (
        <p className="notice danger" role="status">No pudimos leer el calendario en este momento. Intenta de nuevo en un minuto.</p>
      ) : !view.bookings.length ? (
        <div className="empty"><Calendar size={28} /><b>No hay citas próximas</b><span>Las que agende el asistente o la gente por tu enlace aparecen aquí.</span></div>
      ) : (
        [...groups].map(([key, list]) => (
          <section key={key} className="day-group">
            <h3 className="day-title">{dayLabel(list[0].start, config.locale, tz, now)}</h3>
            <ul className="list cards">
              {list.map((b) => {
                const minutes = Math.round((new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000);
                return (
                  <li key={b.id}>
                    <div className="booking">
                      <div className="booking-time">
                        <b>{clock.format(new Date(b.start))}</b>
                        <span>{minutes} min</span>
                      </div>
                      <div className="booking-main">
                        <div className="convo-name">{b.name}</div>
                        <div className="preview">{[b.phone, b.email].filter(Boolean).join(' · ') || b.title}</div>
                        <div className="booking-actions">
                          {b.contactId && (
                            <a className="chip tone-info" href={`/panel/conversaciones/${encodeURIComponent(b.contactId)}?dias=${days}`}><Chat size={14} />Ver conversación</a>
                          )}
                          {b.meetingUrl && (
                            <a className="chip tone-brand" href={b.meetingUrl} target="_blank" rel="noopener noreferrer"><Video size={14} />Unirse</a>
                          )}
                          <a className="chip tone-neutral" href={b.manageUrl} target="_blank" rel="noopener noreferrer"><External size={14} />Reagendar o cancelar</a>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

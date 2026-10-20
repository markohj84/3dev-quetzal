import { getAssistant } from '../../../../assistant';
import { createPanelClient } from '../../../supabase';
import { loadConversation } from '../../../data';
import { contactLink, contactPhone, dayKey, displayName, formatWhen, parseDays } from '../../../shape';

type Props = { params: Promise<{ contactId: string }>; searchParams: Promise<{ dias?: string }> };

export default async function ConversacionPage({ params, searchParams }: Props) {
  const contactId = decodeURIComponent((await params).contactId);
  const days = parseDays((await searchParams).dias);
  const { config } = await getAssistant();
  const back = <a href={`/panel/conversaciones?dias=${days}`}>‹ Conversaciones</a>;
  const data = await loadConversation(await createPanelClient(), contactId);
  if (!data) return <>{back}<p className="notice">Conversación no encontrada.</p></>;

  const { contact, lead, messages } = data;
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  const channel = contact?.channel ?? lead?.channel ?? 'web';
  const reach = lead ? contactLink(lead.contacto, config.followUp?.countryCode) : null;
  let lastDay = '';
  return (
    <>
      {back}
      <h1 style={{ marginTop: 8 }}>{displayName(contactId, channel, contact, lead)}</h1>
      <div className="sub" style={{ marginBottom: 12 }}>
        {channel === 'whatsapp' ? <>WhatsApp · <a href={`https://wa.me/${contactPhone(contactId, 'whatsapp') ?? contactId}`}>+{contactId}</a></> : 'Web'}
        {reach && <> · <a href={reach.href}>{reach.label}</a></>}
        {(contact?.interest || lead?.necesidad) && <> · le interesa: {contact?.interest ?? lead?.necesidad}</>}
      </div>
      <div className="bubbles">
        {messages.map((m, i) => {
          const day = dayKey(m.at, tz);
          const separator = day !== lastDay ? <div className="day">{formatWhen(m.at, config.locale, tz, now)}</div> : null;
          lastDay = day;
          return (
            <div key={i} style={{ display: 'contents' }}>
              {separator}
              <div className={`bubble ${m.role}`}>{m.content}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

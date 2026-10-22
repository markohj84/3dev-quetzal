import { getAssistantOr404 } from '../../../../assistant';
import { createPanelClient } from '../../../supabase';
import { loadConversation } from '../../../data';
import { contactLink, contactPhone, dayKey, displayName, formatWhen, parseDays } from '../../../shape';
import { isTaken, returnsAt, windowOpen } from '../../../../../core/handoff';
import { take, reply, giveBack } from './actions';
import { Live } from './live';

type Props = { params: Promise<{ contactId: string }>; searchParams: Promise<{ dias?: string; aviso?: string }> };

export default async function ConversacionPage({ params, searchParams }: Props) {
  const contactId = decodeURIComponent((await params).contactId);
  const { dias, aviso } = await searchParams;
  const days = parseDays(dias);
  const { config } = await getAssistantOr404();
  const back = <a href={`/panel/conversaciones?dias=${days}`}>‹ Conversaciones</a>;
  const sb = await createPanelClient();
  const userEmail = (await sb.auth.getUser()).data.user?.email;
  const data = await loadConversation(sb, contactId);
  if (!data) return <>{back}<p className="notice">Conversación no encontrada.</p></>;

  const { contact, lead, messages, handoff, lastUserAt } = data;
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
      {aviso && <p className="notice">{aviso}</p>}
      {channel === 'whatsapp' && (() => {
        const now = new Date();
        const taken = isTaken(handoff, now);
        const mine = taken && handoff!.taken_by_email === userEmail;
        const until = taken ? formatWhen(returnsAt(handoff!).toISOString(), config.locale, tz, now) : '';
        if (!taken) {
          return (
            <form className="handoff" action={take.bind(null, contactId)}>
              <span>El asistente está contestando.</span>
              <button type="submit">Tomar conversación</button>
            </form>
          );
        }
        if (!mine) {
          return (
            <form className="handoff" action={take.bind(null, contactId)}>
              <span>La atiende {handoff!.taken_by_email}.</span>
              <button type="submit">Tomarla yo</button>
            </form>
          );
        }
        const open = windowOpen(lastUserAt, now);
        return (
          <div className="handoff mine">
            <Live />
            <span>La atiendes tú · el asistente la retoma {until.replace(/^hoy /, 'a las ')} si no escribes.</span>
            <form action={reply.bind(null, contactId)}>
              <textarea name="text" rows={3} maxLength={4096} disabled={!open}
                placeholder={open ? 'Escribe tu respuesta' : 'WhatsApp solo deja escribir libremente 24 h después del último mensaje de la persona.'} />
              <button type="submit" disabled={!open}>Enviar</button>
            </form>
            <form action={giveBack.bind(null, contactId)}><button type="submit" className="secondary">Devolver al asistente</button></form>
          </div>
        );
      })()}
      <div className="bubbles">
        {messages.map((m, i) => {
          const day = dayKey(m.at, tz);
          const separator = day !== lastDay ? <div className="day">{formatWhen(m.at, config.locale, tz, now)}</div> : null;
          lastDay = day;
          return (
            <div key={i} style={{ display: 'contents' }}>
              {separator}
              <div className={`bubble ${m.role}`}>{m.role === 'human' && <b className="who">Tú · </b>}{m.content}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

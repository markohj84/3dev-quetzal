import { getAssistantOr404 } from '../../../../assistant';
import { createPanelClient } from '../../../supabase';
import { loadConversation } from '../../../data';
import { contactLink, contactPhone, dayKey, displayName, formatWhen, parseDays } from '../../../shape';
import { isTaken, returnsAt, windowOpen } from '../../../../../core/handoff';
import { Avatar, Bot, Chat, ChevronLeft, Globe, Lock, Person, ReturnArrow, Send } from '../../../icons';
import { Submit } from '../../../submit';
import { take, reply, giveBack } from './actions';
import { Live, ScrollToEnd } from './live';

type Props = { params: Promise<{ contactId: string }>; searchParams: Promise<{ dias?: string; aviso?: string }> };

const SPEAKER = { user: null, assistant: 'Asistente', human: 'Tú' } as const;

export default async function ConversacionPage({ params, searchParams }: Props) {
  const contactId = decodeURIComponent((await params).contactId);
  const { dias, aviso } = await searchParams;
  const days = parseDays(dias);
  const { config } = await getAssistantOr404();
  const back = <a className="back" href={`/panel/conversaciones?dias=${days}`}><ChevronLeft /> Conversaciones</a>;
  const sb = await createPanelClient();
  const userEmail = (await sb.auth.getUser()).data.user?.email;
  const data = await loadConversation(sb, contactId);
  if (!data) return <>{back}<p className="notice">Conversación no encontrada.</p></>;

  const { contact, lead, messages, handoff, lastUserAt } = data;
  const tz = config.scheduling.timeZone ?? 'UTC';
  const now = new Date();
  const channel = contact?.channel ?? lead?.channel ?? 'web';
  const name = displayName(contactId, channel, contact, lead);
  const reach = lead ? contactLink(lead.contacto, config.followUp?.countryCode) : null;
  const taken = channel === 'whatsapp' && isTaken(handoff, now);
  const mine = taken && handoff!.taken_by_email === userEmail;
  const until = taken ? formatWhen(returnsAt(handoff!).toISOString(), config.locale, tz, now).replace(/^hoy /, 'a las ') : '';
  const clock = new Intl.DateTimeFormat(config.locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  let lastDay = '';
  let lastRole = '';
  return (
    <>
      {back}
      <div className="contact">
        <Avatar name={name} channel={channel} size="lg" />
        <div>
          <h1>{name}</h1>
          <div className="contact-meta">
            {channel === 'whatsapp'
              ? <span className={`mode ${taken ? 'human' : 'bot'}`}><span className="dot" />{taken ? 'Atiende una persona' : 'Asistente activo'}</span>
              : null}
            {channel === 'whatsapp'
              ? <a href={`https://wa.me/${contactPhone(contactId, 'whatsapp') ?? contactId}`}><Chat size={13} /> +{contactId}</a>
              : <span><Globe size={13} /> Chat web</span>}
            {reach && <a href={reach.href}>{reach.label}</a>}
            {(contact?.interest || lead?.necesidad) && <span>Le interesa: {contact?.interest ?? lead?.necesidad}</span>}
          </div>
        </div>
      </div>
      {aviso && <p className="notice alert" role="status">{aviso}</p>}

      <div className="thread">
        {messages.map((m, i) => {
          const day = dayKey(m.at, tz);
          const separator = day !== lastDay ? <div className="day">{formatWhen(m.at, config.locale, tz, now).replace(/ \d\d:\d\d$/, '')}</div> : null;
          // The speaker's name only when the speaker changes: a run of bubbles reads as one turn.
          const label = (separator || m.role !== lastRole) && SPEAKER[m.role];
          lastDay = day;
          lastRole = m.role;
          return (
            <div key={i} style={{ display: 'contents' }}>
              {separator}
              {label && <div className="who right">{m.role === 'assistant' ? <Bot size={14} /> : <Person size={14} />}{label}</div>}
              <div className={`bubble ${m.role}`}>{m.content}<time dateTime={m.at}>{clock.format(new Date(m.at))}</time></div>
            </div>
          );
        })}
      </div>
      <ScrollToEnd count={messages.length} />

      <div className="dock">
        {channel !== 'whatsapp' ? (
          <div className="readonly"><Lock /> Las conversaciones del chat web son de solo lectura.</div>
        ) : !taken ? (
          <div className="dock-card">
            <form className="dock-row" action={take.bind(null, contactId)}>
              <div className="dock-text">
                <span className="dock-icon"><Bot /></span>
                <div><b>El asistente está contestando</b><span>Si contestas tú, el asistente se pausa hasta que se la devuelvas.</span></div>
              </div>
              <Submit pending="Abriendo…"><Person /> Contestar yo</Submit>
            </form>
          </div>
        ) : !mine ? (
          <div className="dock-card">
            <form className="dock-row" action={take.bind(null, contactId)}>
              <div className="dock-text">
                <span className="dock-icon"><Person /></span>
                <div><b>La atiende {handoff!.taken_by_email ?? 'el negocio desde su WhatsApp'}</b><span>El asistente está en pausa. Lo retoma solo {until} si nadie escribe.</span></div>
              </div>
              <Submit pending="Abriendo…" className="ghost"><Person /> Contestar yo</Submit>
            </form>
          </div>
        ) : (
          <div className="dock-card mine">
            <Live />
            <div className="dock-row">
              <div className="dock-text">
                <span className="dock-icon"><Person /></span>
                <div><b>La atiendes tú · asistente en pausa</b><span>Lo retoma solo {until} si no escribes.</span></div>
              </div>
              <form action={giveBack.bind(null, contactId)}>
                <Submit pending="Devolviendo…" className="amber"><ReturnArrow /> Devolver al asistente</Submit>
              </form>
            </div>
            {(() => {
              const open = windowOpen(lastUserAt, now);
              return (
                <form className="composer" action={reply.bind(null, contactId)}>
                  <textarea name="text" rows={2} maxLength={4096} disabled={!open} aria-label="Tu respuesta"
                    placeholder={open ? `Escribe a ${name}…` : 'WhatsApp solo deja escribir libremente 24 h después del último mensaje de la persona.'} />
                  <Submit pending="Enviando…" disabled={!open}><Send /> Enviar</Submit>
                </form>
              );
            })()}
          </div>
        )}
      </div>
    </>
  );
}

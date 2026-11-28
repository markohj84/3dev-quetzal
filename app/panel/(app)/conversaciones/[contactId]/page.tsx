import { getAssistantOr404 } from '../../../../assistant';
import { createPanelClient } from '../../../supabase';
import { loadConversation } from '../../../data';
import { contactLink, contactPhone, dayKey, displayName, formatWhen, parseDays } from '../../../shape';
import { isTaken, returnsAt, windowOpen } from '../../../../../core/handoff';
import { Avatar, Bot, Chat, ChevronLeft, Globe, Lock, Person, ReturnArrow, Send, UserPlus } from '../../../icons';
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
  if (!data) return <>{back}<p className="notice warn">Conversación no encontrada.</p></>;

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

  // Errors say what failed; "Enviado, pero…" is a warning the message did go out.
  const avisoTone = aviso && /^(No se pudo|Escribe|WhatsApp)/.test(aviso) ? 'danger' : 'warn';
  const interest = contact?.interest ?? lead?.necesidad;
  const leftData = !!lead || !!contact?.left_contact;

  let lastDay = '';
  let lastRole = '';
  return (
    <>
      {back}
      <section className="contact" aria-label="Contacto">
        <Avatar name={name} channel={channel} size="lg" attention={taken} />
        <div className="contact-body">
          <h1>{name}</h1>
          <div className="contact-meta">
            {channel === 'whatsapp'
              ? <a href={`https://wa.me/${contactPhone(contactId, 'whatsapp') ?? contactId}`}><Chat size={14} />+{contactId}</a>
              : <span><Globe size={14} /> Chat web</span>}
            {reach && <><span className="sep">|</span><a href={reach.href}>{reach.label}</a></>}
            {interest && <><span className="sep">|</span><span>Le interesa: {interest}</span></>}
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            {channel === 'whatsapp' && (taken
              ? <span className="chip tone-warn"><span className="dot" />Atiende una persona</span>
              : <span className="chip tone-info"><span className="dot" />Asistente activo</span>)}
            {leftData && <span className="chip tone-lead"><UserPlus size={13} />Dejó datos</span>}
          </div>
        </div>
      </section>
      {aviso && <p className={`notice ${avisoTone}`} role="status">{aviso}</p>}

      <div className="legend" aria-hidden="true">
        <span><i style={{ background: 'var(--bubble-person)' }} />Cliente</span>
        <span><i style={{ background: 'var(--bubble-assistant)', borderColor: 'var(--info-line)' }} />Asistente</span>
        <span><i style={{ background: 'var(--bubble-you)', borderColor: 'var(--bubble-you)' }} />Tú / el negocio</span>
      </div>
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
              {label && <div className={`who ${m.role}`}>{m.role === 'assistant' ? <Bot size={14} /> : <Person size={14} />}{label}</div>}
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
          <div className="dock-card glass">
            <form className="dock-row" action={take.bind(null, contactId)}>
              <div className="dock-text">
                <span className="dock-icon tone-info"><Bot size={20} /></span>
                <div><b>El asistente está contestando</b><p>Si contestas tú, el asistente se pausa hasta que se la devuelvas.</p></div>
              </div>
              <Submit pending="Abriendo…" className="bright lg"><Person /> Contestar yo</Submit>
            </form>
          </div>
        ) : !mine ? (
          <div className="dock-card glass">
            <form className="dock-row" action={take.bind(null, contactId)}>
              <div className="dock-text">
                <span className="dock-icon tone-warn"><Person size={20} /></span>
                <div><b>La atiende {handoff!.taken_by_email ?? 'el negocio desde su WhatsApp'}</b><p>El asistente está en pausa. Lo retoma solo {until} si nadie escribe.</p></div>
              </div>
              <Submit pending="Abriendo…" className="glass-outline lg"><Person /> Contestar yo</Submit>
            </form>
          </div>
        ) : (
          <div className="dock-card glass mine">
            <Live />
            <div className="dock-row">
              <div className="dock-text">
                <span className="dock-icon tone-warn"><Person size={20} /></span>
                <div><b>La atiendes tú · asistente en pausa</b><p>Lo retoma solo {until} si no escribes.</p></div>
              </div>
              <form action={giveBack.bind(null, contactId)}>
                <Submit pending="Devolviendo…" className="glass-warn"><ReturnArrow /> Devolver al asistente</Submit>
              </form>
            </div>
            {(() => {
              const open = windowOpen(lastUserAt, now);
              return (
                <form className="composer" action={reply.bind(null, contactId)}>
                  <label htmlFor="reply" className="composer-label">Tu respuesta a {name}</label>
                  <textarea id="reply" name="text" rows={4} maxLength={4096} disabled={!open}
                    placeholder={open ? 'Escribe aquí tu mensaje…' : 'WhatsApp solo deja escribir libremente 24 h después del último mensaje de la persona.'} />
                  <div className="composer-foot">
                    <span className="composer-hint"><Chat size={14} /> Sale por WhatsApp desde el número del negocio.</span>
                    <Submit pending="Enviando…" disabled={!open} className="bright lg"><Send /> Enviar</Submit>
                  </div>
                </form>
              );
            })()}
          </div>
        )}
      </div>
    </>
  );
}

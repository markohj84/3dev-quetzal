import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAssistantOr404 } from '../../assistant';
import { createPanelClient } from '../supabase';
import { loginMessage, stateAfterSend, stateAfterVerify } from '../shape';
import '../panel.css';
import { panelFont } from '../font';
import { ChevronLeft, Mail } from '../icons';
import { Submit } from '../submit';

export const metadata: Metadata = { title: 'Entrar al panel', robots: { index: false } };

async function sendCode(form: FormData) {
  'use server';
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) redirect('/panel/entrar?estado=correo');
  const sb = await createPanelClient();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  redirect(`/panel/entrar?correo=${encodeURIComponent(email)}&estado=${stateAfterSend(error?.status)}`);
}

async function verifyCode(form: FormData) {
  'use server';
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const token = String(form.get('token') ?? '').replace(/\D/g, '');
  const sb = await createPanelClient();
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) {
    // The same code sent twice (autofill plus a tap): the first one already
    // signed them in, so the second's "used code" is not their problem.
    const { data: { user } } = await sb.auth.getUser();
    if (user?.email?.toLowerCase() === email) redirect('/panel');
  }
  if (error) redirect(`/panel/entrar?correo=${encodeURIComponent(email)}&estado=${stateAfterVerify(error.status)}`);
  redirect('/panel');
}

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ correo?: string; estado?: string }> }) {
  const { correo, estado } = await searchParams;
  const { config } = await getAssistantOr404();
  const message = loginMessage(estado);
  // "Sent" is the normal next step, not a warning: it becomes the step's lead line.
  const problem = estado && estado !== 'enviado' ? message : null;
  const initial = config.organization.trim()[0]?.toUpperCase();
  return (
    <main className={`panel auth-page ${panelFont.variable}`}>
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">{initial}</span>
          <div>
            <b>{config.organization}</b>
            <span>Panel de {config.name}</span>
          </div>
        </div>
        {correo ? (
          <>
            <div className="auth-step">Paso 2 de 2</div>
            <h1>Revisa tu correo</h1>
            {/* Same words for every email: saying "we sent it" would reveal which ones have access. */}
            <p className="auth-lead">{loginMessage('enviado')}</p>
            <p className="auth-email"><Mail size={16} />{correo}</p>
            {problem && <p className="notice danger" role="status">{problem}</p>}
            <form className="auth" action={verifyCode}>
              <input type="hidden" name="email" value={correo} />
              <div className="field">
                <label htmlFor="token">Código de acceso</label>
                {/* Supabase sets the code length per project (6 here, 8 by default): never cut it short. */}
                <input id="token" name="token" className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={10}
                  placeholder="000000" required autoFocus />
              </div>
              <Submit pending="Entrando…" className="block">Entrar al panel</Submit>
            </form>
            <a className="auth-alt" href="/panel/entrar"><ChevronLeft size={16} /> Usar otro correo</a>
          </>
        ) : (
          <>
            <div className="auth-step">Paso 1 de 2</div>
            <h1>Entra a tu panel</h1>
            <p className="auth-lead">Escribe tu correo y te mandamos un código para entrar. Sin contraseñas.</p>
            {problem && <p className="notice danger" role="status">{problem}</p>}
            <form className="auth" action={sendCode}>
              <div className="field">
                <label htmlFor="email">Correo</label>
                <div className="input-icon">
                  <Mail />
                  <input id="email" name="email" type="email" autoComplete="email" placeholder="tu@negocio.com" required autoFocus />
                </div>
              </div>
              <Submit pending="Enviando…" className="block">Enviarme un código</Submit>
            </form>
          </>
        )}
      </div>
      <p className="auth-foot">Solo entran los correos que el equipo dio de alta.</p>
    </main>
  );
}

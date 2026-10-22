import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAssistantOr404 } from '../../assistant';
import { createPanelClient } from '../supabase';
import { loginMessage, stateAfterSend, stateAfterVerify } from '../shape';
import '../panel.css';

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
  return (
    <main className="panel">
      <header>
        <div>
          <h1>{config.organization}</h1>
          <div className="sub">Panel de {config.name}</div>
        </div>
      </header>
      {message && <p className="notice">{message}</p>}
      {correo ? (
        <form action={verifyCode}>
          <input type="hidden" name="email" value={correo} />
          <label htmlFor="token">Código que te llegó a {correo}</label>
          {/* Supabase sets the code length per project (6 here, 8 by default): never cut it short. */}
          <input id="token" name="token" inputMode="numeric" autoComplete="one-time-code" maxLength={10} required autoFocus />
          <button type="submit">Entrar</button>
          <a href="/panel/entrar">Usar otro correo</a>
        </form>
      ) : (
        <form action={sendCode}>
          <label htmlFor="email">Tu correo</label>
          <input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          <button type="submit">Enviarme un código</button>
        </form>
      )}
    </main>
  );
}

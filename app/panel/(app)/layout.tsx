import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAssistantOr404 } from '../../assistant';
import { createPanelClient } from '../supabase';
import '../panel.css';

export const metadata: Metadata = { title: 'Panel', robots: { index: false } };
// Per-user data: never cached, never prerendered.
export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { config } = await getAssistantOr404();
  const sb = await createPanelClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/panel/entrar');

  // RLS only returns this user's own rows: no row here means no access to this client.
  const { data: access } = await sb.from('dashboard_users').select('client_id').eq('client_id', config.id).maybeSingle();

  return (
    <main className="panel">
      <header>
        <div>
          <h1>{config.organization}</h1>
          <div className="sub">Panel de {config.name} · {user.email}</div>
        </div>
        <form action="/panel/salir" method="post"><button type="submit">Salir</button></form>
      </header>
      {access ? children : <p className="notice">No tienes acceso a este panel.</p>}
    </main>
  );
}

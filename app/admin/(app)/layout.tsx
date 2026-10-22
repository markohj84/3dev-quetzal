import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createPanelClient } from '../../panel/supabase';
import '../../panel/panel.css';

export const metadata: Metadata = { title: 'Administración', robots: { index: false } };
// Per-user data: never cached, never prerendered.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sb = await createPanelClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/admin/entrar');
  const { data: isAdmin } = await sb.from('platform_admins').select('user_id').maybeSingle();

  return (
    <main className="panel">
      <header>
        <div>
          <h1>Administración de 3dev</h1>
          <div className="sub">{user.email}</div>
        </div>
        <form action="/admin/salir" method="post"><button type="submit">Salir</button></form>
      </header>
      {isAdmin ? children : <p className="notice">No tienes acceso a esta sección.</p>}
    </main>
  );
}

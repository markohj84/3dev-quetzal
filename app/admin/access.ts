import { redirect } from 'next/navigation';
import { createPanelClient } from '../panel/supabase';

/**
 * Every admin read checks for itself: a request can ask Next to render just
 * the page segment and skip the layout. RLS returns only the caller's own
 * platform_admins row, so a row here means this session is a platform admin.
 */
export async function requireAdmin() {
  const sb = await createPanelClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/admin/entrar');
  const { data, error } = await sb.from('platform_admins').select('user_id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('admin: not a platform admin');
  return sb;
}

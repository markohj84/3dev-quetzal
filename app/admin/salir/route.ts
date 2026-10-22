import { NextResponse } from 'next/server';
import { createPanelClient } from '../../panel/supabase';

export async function POST(request: Request) {
  const sb = await createPanelClient();
  await sb.auth.signOut({ scope: 'local' });
  return NextResponse.redirect(new URL('/admin/entrar', request.url), { status: 303 });
}

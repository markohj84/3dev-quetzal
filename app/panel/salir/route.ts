import { NextResponse } from 'next/server';
import { createPanelClient } from '../supabase';

export async function POST(request: Request) {
  const sb = await createPanelClient();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL('/panel/entrar', request.url), { status: 303 });
}

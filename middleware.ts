import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Refreshes an expiring panel session and writes it back to the response.
 * Only /panel: the chat API, the widget and the webhooks never see it.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        // Responses that set auth cookies must never be cached for someone else.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value as string);
      },
    },
  });
  const { data: { user } } = await sb.auth.getUser();
  // Not only the layout: a request can ask Next to render just the page segment.
  if (!user && request.nextUrl.pathname !== '/panel/entrar') {
    const login = NextResponse.redirect(new URL('/panel/entrar', request.url));
    for (const cookie of response.cookies.getAll()) login.cookies.set(cookie);
    return login;
  }
  return response;
}

export const config = { matcher: ['/panel/:path*'] };

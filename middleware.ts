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
  await sb.auth.getUser();
  return response;
}

export const config = { matcher: ['/panel/:path*'] };

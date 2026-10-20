import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/** One per render, never shared: the session is this request's cookies. */
export async function createPanelClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components can't write cookies; the middleware already refreshed them.
        }
      },
    },
  });
}

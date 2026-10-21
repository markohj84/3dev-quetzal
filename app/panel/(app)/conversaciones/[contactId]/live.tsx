'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** While the owner has the conversation: new messages from the person show up without reloading. */
export function Live({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}

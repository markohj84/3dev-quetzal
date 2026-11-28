'use client';

import { useFormStatus } from 'react-dom';

/** A submit that says it's working: a second tap on "Enviar" would send the WhatsApp twice. */
export function Submit({ children, pending, className, disabled }: {
  children: React.ReactNode; pending: string; className?: string; disabled?: boolean;
}) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || status.pending} aria-busy={status.pending}>
      {status.pending ? pending : children}
    </button>
  );
}

'use client';

export default function PanelError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p className="notice">No pudimos cargar los datos. Intenta de nuevo en un momento.</p>
      <button type="button" onClick={reset}>Reintentar</button>
    </div>
  );
}

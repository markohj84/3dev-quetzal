'use client';

export default function PanelError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p className="notice danger">No pudimos cargar los datos. Intenta de nuevo en un momento.</p>
      <button type="button" className="btn" onClick={reset}>Reintentar</button>
    </div>
  );
}

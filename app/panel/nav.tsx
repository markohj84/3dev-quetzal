type Tab = 'resumen' | 'conversaciones' | 'leads';
const TABS: [Tab, string, string][] = [
  ['resumen', 'Resumen', '/panel'],
  ['conversaciones', 'Conversaciones', '/panel/conversaciones'],
  ['leads', 'Leads', '/panel/leads'],
];

/** `filters` sits left of the period picker, on the same row. */
export function Nav({ active, days, filters }: { active: Tab; days: 7 | 30 | 90; filters?: React.ReactNode }) {
  const path = TABS.find(([id]) => id === active)![2];
  return (
    <>
      <nav className="tabs">
        {TABS.map(([id, label, href]) => (
          <a key={id} href={`${href}?dias=${days}`} aria-current={id === active ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <div className="toolbar">
        {filters ?? <span />}
        <div className="period" aria-label="Periodo">
          {[7, 30, 90].map((d) => (
            <a key={d} href={`${path}?dias=${d}`} aria-current={d === days ? 'true' : undefined}>{d} días</a>
          ))}
        </div>
      </div>
    </>
  );
}

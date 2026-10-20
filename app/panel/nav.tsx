type Tab = 'resumen' | 'conversaciones' | 'leads';
const TABS: [Tab, string, string][] = [
  ['resumen', 'Resumen', '/panel'],
  ['conversaciones', 'Conversaciones', '/panel/conversaciones'],
  ['leads', 'Leads', '/panel/leads'],
];

export function Nav({ active, days }: { active: Tab; days: 7 | 30 | 90 }) {
  const path = TABS.find(([id]) => id === active)![2];
  return (
    <>
      <nav className="tabs">
        {TABS.map(([id, label, href]) => (
          <a key={id} href={`${href}?dias=${days}`} aria-current={id === active ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <div className="period">
        {[7, 30, 90].map((d) => (
          <a key={d} href={`${path}?dias=${d}`} aria-current={d === days ? 'true' : undefined}>{d} días</a>
        ))}
      </div>
    </>
  );
}

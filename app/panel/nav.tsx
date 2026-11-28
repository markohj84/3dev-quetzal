import { Calendar, Chart, Chat, UserPlus } from './icons';

type Tab = 'resumen' | 'conversaciones' | 'citas' | 'leads';
// Each module keeps its hue (tone) on its icon only: color tells you where you are, not decoration.
const TABS: [Tab, string, string, React.ReactNode, string][] = [
  ['resumen', 'Resumen', '/panel', <Chart key="i" />, 'brand'],
  ['conversaciones', 'Conversaciones', '/panel/conversaciones', <Chat key="i" />, 'info'],
  ['citas', 'Citas', '/panel/citas', <Calendar key="i" />, 'brand'],
  ['leads', 'Leads', '/panel/leads', <UserPlus key="i" />, 'lead'],
];

/** `filters` sits left of the period picker; `period: false` for a page that isn't a look back (upcoming bookings). */
export function Nav({ active, days, filters, period = true }: { active: Tab; days: 7 | 30 | 90; filters?: React.ReactNode; period?: boolean }) {
  const path = TABS.find(([id]) => id === active)![2];
  return (
    <>
      <nav className="tabs">
        {TABS.map(([id, label, href, icon, tone]) => (
          <a key={id} href={`${href}?dias=${days}`} className={`tone-${tone}`} aria-current={id === active ? 'page' : undefined}>
            <span className="tab-icon">{icon}</span>{label}
          </a>
        ))}
      </nav>
      {(period || filters) && (
        <div className="toolbar">
          {filters ?? <span />}
          {period && (
            <div className="period" aria-label="Periodo">
              {[7, 30, 90].map((d) => (
                <a key={d} href={`${path}?dias=${d}`} aria-current={d === days ? 'true' : undefined}>{d} días</a>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

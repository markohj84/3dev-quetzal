import { initials } from './shape';

// Inline strokes, no icon package: the panel uses a handful and they never change.
type P = { size?: number };
const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);

export const ChevronRight = ({ size = 18 }: P) => svg(size, <path d="m9 6 6 6-6 6" />);
export const ChevronLeft = ({ size = 18 }: P) => svg(size, <path d="m15 6-6 6 6 6" />);
export const Send = ({ size = 18 }: P) => svg(size, <><path d="M4 12 20 4l-4 16-4-7-8-1Z" /><path d="m12 13 8-9" /></>);
export const Bot = ({ size = 18 }: P) => svg(size, <><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01" /></>);
export const Person = ({ size = 18 }: P) => svg(size, <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.5 3.8-5 7-5s5.8 1.5 7 5" /></>);
export const ReturnArrow = ({ size = 18 }: P) => svg(size, <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>);
export const Chat = ({ size = 16 }: P) => svg(size, <path d="M5 18.5 3.5 21l.9-3.7A8 8 0 1 1 7.5 19.6Z" />);
export const Globe = ({ size = 16 }: P) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" /></>);
export const Lock = ({ size = 16 }: P) => svg(size, <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const Chart = ({ size = 16 }: P) => svg(size, <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>);
export const Users = ({ size = 16 }: P) => svg(size, <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.9-3 3.2-4.5 6-4.5s5.1 1.5 6 4.5M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.4.6 2.4 2 2.9 4.2" /></>);
export const UserPlus = ({ size = 16 }: P) => svg(size, <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20c1.1-3.4 3.6-5 6.5-5s5.4 1.6 6.5 5M19 8v6M16 11h6" /></>);
export const Calendar = ({ size = 16 }: P) => svg(size, <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M4 10h16M9 14.5l2 2 4-4" /></>);
export const Video = ({ size = 16 }: P) => svg(size, <><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10.5 5-3v9l-5-3" /></>);
export const External = ({ size = 16 }: P) => svg(size, <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>);
export const Mail = ({ size = 18 }: P) => svg(size, <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>);
export const Inbox = ({ size = 28 }: P) => svg(size, <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" /></>);

export function Avatar({ name, channel, size = 'md', attention }: { name: string; channel: string; size?: 'md' | 'lg'; attention?: boolean }) {
  const letters = initials(name);
  // Same name, same tint on every page.
  const tint = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 5;
  return (
    <span className={`avatar ${size} t${tint}${attention ? ' attention' : ''}`} aria-hidden="true">
      {letters ?? (channel === 'whatsapp' ? <Chat size={18} /> : <Globe size={18} />)}
    </span>
  );
}

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
export const Inbox = ({ size = 28 }: P) => svg(size, <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" /></>);

export function Avatar({ name, channel, size = 'md' }: { name: string; channel: string; size?: 'md' | 'lg' }) {
  const letters = initials(name);
  return (
    <span className={`avatar ${size}`} aria-hidden="true">
      {letters ?? (channel === 'whatsapp' ? <Chat size={18} /> : <Globe size={18} />)}
    </span>
  );
}

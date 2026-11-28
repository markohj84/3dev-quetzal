import { Geist } from 'next/font/google';

// Self-hosted at build time by Next: no request to Google from the owner's browser.
export const panelFont = Geist({ subsets: ['latin'], variable: '--font-panel', display: 'swap' });

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import './globals.css';
import SiteFooter from '@/components/site-footer';
import SiteHeader from '@/components/site-header';

/* Two faces, each with a job. Geist carries interface and body copy;
   Geist Mono handles notation and clocks, where digit widths must not
   shift. All three of the original faces were doing the same job the
   heading weight and tracking now do. */
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Arbiter — chess tournaments, drawn automatically',
  description:
    'Host a chess tournament, add your players, and let the pairings generate themselves. Play live or correspondence games and review every move with Stockfish.',
};

/* Runs before first paint, so the palette is already correct when the very
   first frame is composited. Doing this in a React effect instead would paint
   the light theme, then swap — a full-page flash on every load in dark mode.

   Order of preference: an explicit choice the user made, then the OS setting.
   Kept in sync with `lib/use-theme.ts`. */
const themeScript = `(function(){try{var s=localStorage.getItem('arbiter-theme');var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable}`}
      /* Tells Next that the smooth scrolling in globals.css is intentional,
         so it can turn it off for the duration of a client-side navigation
         instead of warning about it on every route change. */
      data-scroll-behavior="smooth"
      /* The script above writes `data-theme` onto this element before React
         hydrates, so the client attribute genuinely differs from the server
         HTML. That difference is the entire point of the script and not a
         bug, so the warning is suppressed here and only here. */
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

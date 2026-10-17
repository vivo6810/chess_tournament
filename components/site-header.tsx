'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import GooeyNav, { type GooeyNavItem } from '@/components/gooey-nav/GooeyNav';
import ThemeToggle from '@/components/theme-toggle';
import { useTheme } from '@/lib/use-theme';

const NAV: GooeyNavItem[] = [
  { label: 'Play', href: '/' },
  { label: 'Tournaments', href: '/tournaments' },
  { label: 'Host', href: '/tournaments/new' },
  { label: 'Analysis', href: '/analysis' },
  { label: 'Leaderboard', href: '/leaderboard' },
];

/* Longest prefix wins, so /tournaments/new resolves to "Host" rather
   than being swallowed by /tournaments. */
const activeIndexFor = (pathname: string) => {
  let best = 0;
  let bestLength = -1;
  NAV.forEach((item, index) => {
    const href = item.href ?? '/';
    const matches = href === '/' ? pathname === '/' : pathname.startsWith(href);
    if (matches && href.length > bestLength) {
      best = index;
      bestLength = href.length;
    }
  });
  return best;
};

export default function SiteHeader() {
  const pathname = usePathname();
  /* GooeyNav draws its gooey particles on a canvas, so those colours have to
     be literal values rather than var() references and still come from JS.
     The frame chrome is driven by CSS and is therefore already correct on the
     first paint — only the particles settle a beat after hydration. */
  const theme = useTheme();

  return (
    <header className="sticky top-0 z-50 border-b-2 border-line/70 bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <Link
          href="/"
          className="shrink-0 text-[15px] font-semibold tracking-[-0.03em] text-ink transition-colors hover:text-ink-soft"
        >
          Arbiter
        </Link>

        <div className="flex min-w-0 items-center gap-3">
          <GooeyNav
            aria-label="Sections"
            items={NAV}
            size="sm"
            theme={theme}
            /* Lets the stylesheet own the frame colours so they follow
               `[data-theme]` from the very first frame. */
            adaptive
            activeIndex={activeIndexFor(pathname)}
            /* Navigation is the link's job. Pushing here as well navigated
               twice — once by the anchor, once by the router — and the second
               push cut off the press animation the first one started. */
            linkComponent={Link}
          />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

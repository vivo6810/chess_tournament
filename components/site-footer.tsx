import Link from 'next/link';

const COLUMNS = [
  {
    title: 'Play',
    links: [
      { label: 'Browse tournaments', href: '/tournaments' },
      { label: 'Host a tournament', href: '/tournaments/new' },
      { label: 'Leaderboard', href: '/leaderboard' },
    ],
  },
  {
    title: 'Study',
    links: [
      { label: 'Analysis board', href: '/analysis' },
      { label: 'Sign in', href: '/login' },
    ],
  },
];

/**
 * A server component with no state and no effects. Every link in it is a real
 * anchor in the served HTML — the footer is the page most likely to be read by
 * something that does not run a script, so it is also the page most worth
 * keeping static.
 */
export default function SiteFooter() {
  return (
    <footer className="border-t-2 border-ink bg-canvas">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Arbiter</p>
          <p className="mt-3 max-w-[34ch] text-[13px] leading-relaxed text-muted">
            Tournament software for people who would rather play than administrate. Pairings,
            clocks and review in one place.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
              {column.title}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-[13px] text-ink-soft underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}

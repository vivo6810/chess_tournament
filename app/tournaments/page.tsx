import Link from 'next/link';

import { listTournaments } from '@/lib/service';
import { getTimeControl } from '@/lib/time-controls';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tournaments — Arbiter' };

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-bone text-muted',
  running: 'bg-info-bg text-info-fg',
  finished: 'bg-win-bg text-win-fg',
};

export default function TournamentsPage() {
  const tournaments = listTournaments();

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <h1 className="font-extrabold text-[36px] leading-[1.12] tracking-[-0.03em] text-ink">
            Tournaments
          </h1>
          <p className="mt-3 text-[15px] text-muted">
            Every event on this instance, newest first. Open one to see the standings, the draw,
            and the games.
          </p>
        </div>
        <Link
          href="/tournaments/new"
          className="press rounded-none bg-accent px-5 py-3 text-[14px] font-medium text-on-accent transition-colors hover:bg-accent/90"
        >
          Host a tournament
        </Link>
      </header>

      {tournaments.length === 0 ? (
        <div className="mt-12 rounded-none border-2 border-line bg-surface shadow-brut px-7 py-10">
          <p className="text-[15px] text-ink">Nothing here yet.</p>
          <p className="mt-1.5 text-[14px] text-muted">
            Create the first tournament and the pairings will generate themselves.
          </p>
        </div>
      ) : (
        /* Cards, not a grid of cells. The old version painted the container
           `line` and each item `surface`, so the empty slots in the last row
           showed through as one large tan rectangle — fine at nine events,
           broken at one. Separate cards have no empty slots to leak. */
        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((tournament) => {
            const control = getTimeControl(tournament.time_control);
            return (
              <li
                key={tournament.id}
                className="lift border-2 border-ink bg-surface shadow-brut"
              >
                <Link href={`/tournaments/${tournament.slug}`} className="lift block h-full px-6 py-6">
                  <span className={`badge ${STATUS_STYLE[tournament.status] ?? 'bg-bone text-muted'}`}>
                    {tournament.status === 'draft'
                      ? 'Not started'
                      : tournament.status === 'running'
                        ? `Round ${tournament.current_round} of ${tournament.total_rounds}`
                        : 'Finished'}
                  </span>
                  <h2 className="mt-4 text-[17px] font-semibold text-ink">{tournament.name}</h2>
                  <dl className="mt-3 space-y-1 text-[13px] text-muted">
                    <div className="flex justify-between gap-3">
                      <dt>Format</dt>
                      <dd className="text-ink-soft">
                        {tournament.format === 'swiss' ? 'Swiss' : 'Round robin'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Time control</dt>
                      <dd className="font-mono text-ink-soft">{control.label}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Players</dt>
                      <dd className="text-ink-soft">{tournament.player_count}</dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-[12px] text-muted">Hosted by {tournament.host_name}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

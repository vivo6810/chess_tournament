import Link from 'next/link';
import { notFound } from 'next/navigation';

import TournamentControls from '@/components/tournament-controls';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import {
  getTournamentBySlug,
  listPlayers,
  roundView,
  standingsFor,
  unfinishedGames,
} from '@/lib/service';
import { describeTimeControl, getTimeControl } from '@/lib/time-controls';

export const dynamic = 'force-dynamic';

const RESULT_LABEL: Record<string, string> = {
  '1-0': '1–0',
  '0-1': '0–1',
  '1/2-1/2': '½–½',
};

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tournament = getTournamentBySlug(slug);
  if (!tournament) notFound();

  const user = await getCurrentUser();
  /* The built-in admin runs every event, not just the ones it created. */
  const isHost = isAdmin(user) || (user != null && user.id === tournament.host_id);

  const players = listPlayers(tournament.id);
  const active = new Set(players.filter((player) => player.withdrawn === 0).map((p) => p.id));
  const standings = standingsFor(tournament.id).filter((row) => active.has(row.playerId));
  const control = getTimeControl(tournament.time_control);
  const pending = unfinishedGames(tournament.id);

  const rounds = Array.from({ length: tournament.current_round }, (_, index) => index + 1);

  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <header className="border-b-2 border-line pb-8">
        <Link href="/tournaments" className="text-[13px] text-muted hover:text-ink">
          ← All tournaments
        </Link>
        {tournament.suspended === 1 ? (
          <p className="mt-4 border-2 border-loss-fg bg-loss-bg px-3 py-2 text-[12px] font-bold text-loss-fg">
            Suspended by the owner. No moves, results or new rounds until it is restored.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-extrabold text-[36px] leading-[1.12] tracking-[-0.03em] text-ink">
              {tournament.name}
            </h1>
            <p className="mt-2 text-[14px] text-muted">
              {tournament.format === 'swiss' ? 'Swiss' : 'Round robin'} ·{' '}
              {describeTimeControl(control)} · {players.length} players
            </p>
          </div>
          <span className="badge bg-bone text-muted">
            {tournament.status === 'draft'
              ? 'Not started'
              : tournament.status === 'running'
                ? `Round ${tournament.current_round} of ${tournament.total_rounds}`
                : 'Finished'}
          </span>
        </div>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-12">
          <section>
            <h2 className="text-[12px] font-medium tracking-[0.08em] text-muted uppercase">
              Standings
            </h2>
            {standings.length === 0 ? (
              <p className="mt-3 text-[14px] text-muted">No players yet.</p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-none border-2 border-line">
                <table className="w-full border-collapse text-[14px]">
                  <thead>
                    <tr className="border-b-2 border-line bg-surface-sunken text-[11px] tracking-[0.06em] text-muted uppercase">
                      <th className="px-4 py-2.5 text-left font-medium">#</th>
                      <th className="px-4 py-2.5 text-left font-medium">Player</th>
                      <th className="px-4 py-2.5 text-right font-medium">Pts</th>
                      <th className="px-4 py-2.5 text-right font-medium">Pld</th>
                      <th className="px-4 py-2.5 text-right font-medium">Buch</th>
                      <th className="px-4 py-2.5 text-right font-medium">SB</th>
                      <th className="px-4 py-2.5 text-left font-medium">Colours</th>
                    </tr>
                  </thead>
                  <tbody className="bg-surface">
                    {standings.map((row) => (
                      <tr key={row.playerId} className="border-b-2 border-line last:border-0">
                        <td className="px-4 py-2.5 font-mono text-[12px] text-muted">{row.rank}</td>
                        <td className="px-4 py-2.5 text-ink">{row.name}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">
                          {row.score % 1 === 0 ? row.score : row.score.toFixed(1)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                          {row.played}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                          {row.buchholz % 1 === 0 ? row.buchholz : row.buchholz.toFixed(1)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                          {row.sonnebornBerger % 1 === 0
                            ? row.sonnebornBerger
                            : row.sonnebornBerger.toFixed(1)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[12px] text-muted">
                          {row.colors.join(' ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {rounds.map((round) => (
            <section key={round}>
              <h2 className="text-[12px] font-medium tracking-[0.08em] text-muted uppercase">
                Round {round}
              </h2>
              <ul className="mt-4 divide-y-2 divide-line overflow-hidden rounded-none border-2 border-line bg-surface shadow-brut">
                {roundView(tournament.id, round).map(({ pairing, whiteName, blackName, game }) => (
                  <li key={pairing.id} className="flex items-center gap-4 px-5 py-3">
                    <span className="w-6 font-mono text-[12px] text-muted">{pairing.board}</span>
                    <span className="flex-1 text-[14px] text-ink">
                      {pairing.is_bye ? (
                        <span className="text-muted">{whiteName} — bye</span>
                      ) : (
                        <>
                          {whiteName} <span className="text-muted">vs</span> {blackName}
                        </>
                      )}
                    </span>
                    {pairing.result ? (
                      <span className="font-mono text-[13px] text-ink-soft">
                        {RESULT_LABEL[pairing.result] ?? pairing.result}
                      </span>
                    ) : pairing.is_bye ? (
                      <span className="badge bg-win-bg text-win-fg">Bye</span>
                    ) : game ? (
                      <Link
                        href={`/games/${game.id}`}
                        className="press rounded-none border-2 border-line-strong px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-bone"
                      >
                        {game.status === 'active' ? 'Play' : 'Review'}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {tournament.status === 'draft' ? (
            <p className="text-[14px] text-muted">
              The draw appears here once the tournament starts.
            </p>
          ) : null}
        </div>

        <aside className="space-y-6">
          {isHost ? (
            <TournamentControls
            suspended={tournament.suspended === 1}
              slug={tournament.slug}
              status={tournament.status}
              currentRound={tournament.current_round}
              totalRounds={tournament.total_rounds}
              pendingGames={pending}
            />
          ) : null}

          <section className="overflow-hidden rounded-none border-2 border-line bg-surface shadow-brut">
            <header className="border-b-2 border-line px-5 py-3">
              <h2 className="text-[13px] font-semibold text-ink">Field</h2>
            </header>
            <ol className="divide-y-2 divide-line">
              {players.map((player) => (
                <li
                  key={player.id}
                  className="flex items-center justify-between px-5 py-2.5 text-[14px]"
                >
                  <span className={player.withdrawn ? 'text-muted line-through' : 'text-ink'}>
                    {player.name}
                  </span>
                  <span className="font-mono text-[12px] text-muted">{player.seed}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

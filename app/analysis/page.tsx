import Link from 'next/link';

import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analysis — Arbiter' };

type FinishedGame = {
  id: number;
  result: string | null;
  termination: string | null;
  round_no: number | null;
  board: number | null;
  white_name: string;
  black_name: string;
  tournament_name: string | null;
  tournament_slug: string | null;
};

export default function AnalysisPage() {
  /* Only finished games are worth reviewing — there is nothing to score while a
     position is still being played. */
  const games = db
    .prepare(
      `SELECT g.id, g.result, g.termination, g.round_no, g.board,
              wp.name AS white_name, bp.name AS black_name,
              t.name AS tournament_name, t.slug AS tournament_slug
       FROM games g
       JOIN tournament_players wp ON wp.id = g.white_player_id
       JOIN tournament_players bp ON bp.id = g.black_player_id
       LEFT JOIN tournaments t ON t.id = g.tournament_id
       WHERE g.status = 'finished'
       ORDER BY g.updated_at DESC
       LIMIT 60`,
    )
    .all() as FinishedGame[];

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <header className="max-w-2xl">
        <h1 className="font-extrabold text-[36px] leading-[1.12] tracking-[-0.03em] text-ink">
          Analysis
        </h1>
      </header>

      {games.length === 0 ? (
        <p className="mt-10 border-2 border-ink bg-surface px-5 py-4 text-[14px] text-muted shadow-brut">
          No finished games yet.
        </p>
      ) : (
        /* Separate cards rather than one bordered grid: with two finished
           games the unused cells of the grid showed as a tan void. */
        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <li key={game.id} className="lift border-2 border-ink bg-surface shadow-brut">
              <Link href={`/games/${game.id}`} className="lift block h-full px-6 py-5">
                <p className="text-[11px] tracking-[0.06em] text-muted uppercase">
                  {game.tournament_name ?? 'Standalone game'}
                  {game.round_no ? ` · R${game.round_no} B${game.board}` : ''}
                </p>
                <p className="mt-3 text-[15px] text-ink">
                  {game.white_name} <span className="text-muted">vs</span> {game.black_name}
                </p>
                <p className="mt-2 font-mono text-[13px] text-muted">
                  {game.result ?? 'unfinished'}
                  {game.termination ? ` · ${game.termination}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

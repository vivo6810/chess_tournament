import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leaderboard — Arbiter' };

type Row = {
  id: number;
  name: string;
  result: string | null;
  white_id: number | null;
  black_id: number | null;
  is_bye: number;
};

type Tally = {
  playerId: number;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
};

export default function LeaderboardPage() {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, pa.result, pa.white_id, pa.black_id, pa.is_bye
       FROM tournament_players p
       LEFT JOIN pairings pa ON (pa.white_id = p.id OR pa.black_id = p.id)
       ORDER BY p.name ASC`,
    )
    .all() as Row[];

  /* Tallied in JS rather than SQL: a self-join on `white_id OR black_id` would
     double-count each pairing. */
  const tallies = new Map<number, Tally>();
  for (const row of rows) {
    let tally = tallies.get(row.id);
    if (!tally) {
      tally = {
        playerId: row.id,
        name: row.name,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        score: 0,
      };
      tallies.set(row.id, tally);
    }
    if (row.result == null) continue;

    tally.played += 1;
    if (row.is_bye === 1) {
      tally.wins += 1;
      tally.score += 1;
      continue;
    }

    const isWhite = row.white_id === row.id;
    if (row.result === '1/2-1/2') {
      tally.draws += 1;
      tally.score += 0.5;
    } else if ((row.result === '1-0' && isWhite) || (row.result === '0-1' && !isWhite)) {
      tally.wins += 1;
      tally.score += 1;
    } else {
      tally.losses += 1;
    }
  }

  const ranked = [...tallies.values()]
    .filter((tally) => tally.played > 0)
    .sort((a, b) => b.score - a.score || b.wins - a.wins || a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <header className="max-w-2xl">
        <h1 className="font-extrabold text-[36px] leading-[1.12] tracking-[-0.03em] text-ink">
          Leaderboard
        </h1>
        <p className="mt-3 text-[15px] text-muted">
          Every player who has finished a tournament game, scored the same way a tournament scores
          them: a win is one point, a draw is half.
        </p>
      </header>

      {ranked.length === 0 ? (
        <div className="mt-12 rounded-none border-2 border-line bg-surface shadow-brut px-7 py-10">
          <p className="text-[15px] text-ink">No results recorded yet.</p>
        </div>
      ) : (
        <div className="mt-12 overflow-hidden rounded-none border-2 border-line">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b-2 border-line bg-surface-sunken text-[11px] tracking-[0.06em] text-muted uppercase">
                <th className="px-4 py-2.5 text-left font-medium">#</th>
                <th className="px-4 py-2.5 text-left font-medium">Player</th>
                <th className="px-4 py-2.5 text-right font-medium">Pts</th>
                <th className="px-4 py-2.5 text-right font-medium">Pld</th>
                <th className="px-4 py-2.5 text-right font-medium">W</th>
                <th className="px-4 py-2.5 text-right font-medium">D</th>
                <th className="px-4 py-2.5 text-right font-medium">L</th>
              </tr>
            </thead>
            <tbody className="bg-surface">
              {ranked.map((tally, index) => (
                <tr key={tally.playerId} className="border-b-2 border-line last:border-0">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-muted">{index + 1}</td>
                  <td className="px-4 py-2.5 text-ink">{tally.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">
                    {tally.score % 1 === 0 ? tally.score : tally.score.toFixed(1)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                    {tally.played}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                    {tally.wins}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                    {tally.draws}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                    {tally.losses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

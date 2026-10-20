'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import PlayerEntry from '@/components/player-entry';

type Props = {
  slug: string;
  status: 'draft' | 'running' | 'finished';
  currentRound: number;
  totalRounds: number;
  pendingGames: number;
  suspended?: boolean;
};

export default function TournamentControls({
  slug,
  status,
  currentRound,
  totalRounds,
  pendingGames,
  suspended = false,
}: Props) {
  const router = useRouter();
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/tournaments/${slug}/${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Request failed.' }));
      setError(payload.error ?? 'Request failed.');
    } else {
      setNames([]);
    }
    setBusy(false);
    router.refresh();
  };

  const lastRound = currentRound >= totalRounds;

  return (
    <section className="border-2 border-ink bg-surface shadow-brut">
      <header className="border-b-2 border-ink px-5 py-3">
        <h2 className="text-[13px] font-bold text-ink">Host controls</h2>
      </header>

      <div className="space-y-5 px-5 py-5">
        {suspended ? (
          <p className="border-2 border-loss-fg bg-loss-bg px-3 py-2 text-[12px] font-medium text-loss-fg">
            The owner has suspended this event. Controls are locked until it is restored.
          </p>
        ) : null}

        {status === 'draft' ? (
          <>
            <PlayerEntry
              names={names}
              onChange={setNames}
              busy={busy}
              hint="Type one name or email, then press Enter."
            />
            <button
              type="button"
              disabled={busy || suspended || names.length === 0}
              onClick={() => run('players', { names })}
              className="press w-full border-2 border-ink bg-surface px-3.5 py-2 text-[12px] font-bold text-ink shadow-brut-sm"
            >
              Add {names.length > 0 ? `${names.length} to the field` : 'to the field'}
            </button>

            <button
              type="button"
              disabled={busy || suspended}
              onClick={() => run('start')}
              className="press w-full border-2 border-ink bg-accent px-3.5 py-2.5 text-[13px] font-bold text-on-accent shadow-brut"
            >
              {busy ? 'Working…' : 'Start and draw round 1'}
            </button>
          </>
        ) : null}

        {status === 'running' ? (
          <>
            <p className="text-[13px] text-ink-soft">
              {pendingGames > 0
                ? `${pendingGames} game${pendingGames === 1 ? '' : 's'} still running.`
                : `Round ${currentRound} complete.`}
            </p>
            <button
              type="button"
              disabled={busy || suspended || pendingGames > 0 || lastRound}
              onClick={() => run('advance')}
              className="press w-full border-2 border-ink bg-accent px-3.5 py-2.5 text-[13px] font-bold text-on-accent shadow-brut"
            >
              {lastRound ? 'Final round' : busy ? 'Drawing…' : `Draw round ${currentRound + 1}`}
            </button>
          </>
        ) : null}

        {status === 'finished' ? (
          <p className="text-[13px] text-muted">Every round has been played.</p>
        ) : null}

        {error ? (
          <p className="border-2 border-loss-fg bg-loss-bg px-3 py-2 text-[12px] font-medium text-loss-fg">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

'use client';

import { Chess } from 'chess.js';
import { useEffect, useRef, useState } from 'react';

import { formatScore, toWhitePawns, useEngine, type EngineScore } from '@/lib/use-engine';

type Props = {
  fen: string;
  /** Depth to search to. Twelve is a good trade-off for an interactive panel. */
  depth?: number;
  autoStart?: boolean;
};

export default function EnginePanel({ fen, depth = 12, autoStart = false }: Props) {
  const { ready, error, analyse, stop } = useEngine();
  const [running, setRunning] = useState(autoStart);
  const [score, setScore] = useState<EngineScore | null>(null);
  const [thinking, setThinking] = useState(false);
  const fenRef = useRef(fen);
  fenRef.current = fen;

  const turn = (() => {
    try {
      return new Chess(fen).turn();
    } catch {
      return 'w' as const;
    }
  })();

  useEffect(() => {
    if (!running || !ready) return undefined;

    let cancelled = false;
    setThinking(true);

    analyse(fen, depth, (update) => {
      if (!cancelled) setScore(update);
    }).then((final) => {
      if (cancelled) return;
      setScore(final);
      setThinking(false);
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [fen, depth, running, ready, analyse, stop]);

  // Turning the panel off must actually release the engine, not just hide it.
  useEffect(() => {
    if (!running) {
      stop();
      setThinking(false);
    }
  }, [running, stop]);

  const pawns = score ? toWhitePawns(score, turn) : null;
  // Clamp to +/-5 pawns so a decisive position fills the bar without the
  // scale collapsing for normal positions.
  const whiteShare =
    pawns == null ? 0.5 : Math.max(0.03, Math.min(0.97, (pawns + 5) / 10));

  return (
    <section className="overflow-hidden rounded-none border-2 border-line bg-surface shadow-brut">
      <header className="flex items-center justify-between border-b-2 border-line px-5 py-3">
        <h2 className="text-[13px] font-semibold text-ink">Engine</h2>
        <button
          type="button"
          onClick={() => setRunning((value) => !value)}
          disabled={!ready && !error}
          className="press rounded-none border-2 border-line-strong px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-bone disabled:opacity-40"
        >
          {error ? 'Unavailable' : running ? 'Stop' : 'Analyse'}
        </button>
      </header>

      {error ? (
        <p className="px-5 py-4 text-[13px] text-muted">{error}</p>
      ) : (
        <>
          <div className="px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
                Evaluation
              </span>
              <span className="font-mono text-[15px] text-ink tabular-nums">
                {score ? formatScore(score, turn) : ready ? '—' : 'loading'}
              </span>
            </div>

            <div className="mt-3 flex h-1.5 overflow-hidden rounded-none bg-solid">
              <div
                className="bg-canvas transition-[width] duration-200 ease-out"
                style={{ width: `${whiteShare * 100}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted">
              <span>white</span>
              <span>black</span>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-px border-t-2 border-line bg-line">
            <div className="bg-surface px-5 py-3">
              <dt className="text-[10px] tracking-[0.08em] text-muted uppercase">Depth</dt>
              <dd className="font-mono text-[13px] text-ink tabular-nums">
                {score?.depth ?? 0}
                {thinking ? '…' : ''}
              </dd>
            </div>
            <div className="bg-surface px-5 py-3">
              <dt className="text-[10px] tracking-[0.08em] text-muted uppercase">Best move</dt>
              <dd className="font-mono text-[13px] text-ink">{score?.best ?? '—'}</dd>
            </div>
          </dl>

          {score?.pv?.length ? (
            <div className="border-t-2 border-line px-5 py-3">
              <p className="text-[10px] tracking-[0.08em] text-muted uppercase">
                Principal variation
              </p>
              <p className="mt-1 truncate font-mono text-[12px] text-ink-soft">
                {score.pv.slice(0, 8).join(' ')}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

'use client';

import { useMemo, useState } from 'react';

import { legalMoveCount } from '@/lib/game';
import { accuracyFromLoss, classifyMove, ratingFromAccuracy, type MoveVerdict } from '@/lib/review';
import { useEngine } from '@/lib/use-engine';

export type ReviewMove = { san: string; uci: string; fen: string };

type PlyReview = {
  ply: number;
  san: string;
  mover: 'w' | 'b';
  loss: number;
  verdict: MoveVerdict;
  /** White-relative centipawns after the move. */
  cpWhite: number;
};

const VERDICT_STYLE: Record<MoveVerdict, string> = {
  forced: 'bg-bone text-muted',
  best: 'bg-win-bg text-win-fg',
  excellent: 'bg-win-bg text-win-fg',
  good: 'bg-bone text-muted',
  inaccuracy: 'bg-draw-bg text-draw-fg',
  mistake: 'bg-loss-bg text-loss-fg',
  /* A blunder is the one label that should hurt to look at. */
  blunder: 'bg-loss-fg text-loss-bg',
};

const turnOf = (fen: string): 'w' | 'b' => (fen.split(' ')[1] === 'w' ? 'w' : 'b');

/** Mate scores are folded into a large centipawn value so loss arithmetic works. */
const toWhiteCp = (cp: number | null, mate: number | null, turn: 'w' | 'b'): number => {
  if (mate != null) {
    const forWhite = turn === 'w' ? mate : -mate;
    return forWhite > 0 ? 10_000 : -10_000;
  }
  const value = cp ?? 0;
  return turn === 'w' ? value : -value;
};

/** Anything past ±5 pawns already means "winning"; the bar stops there. */
const clampCp = (value: number) => Math.max(-500, Math.min(500, value));

export default function GameReview({
  initialFen,
  moves,
  depth = 12,
}: {
  initialFen: string;
  moves: ReviewMove[];
  depth?: number;
}) {
  const { ready, error, analyse, stop } = useEngine();
  const [reviews, setReviews] = useState<PlyReview[]>([]);
  const [scores, setScores] = useState<number[]>([]);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  /* Index into `positions`: 0 is the position before the first move. */
  const [selected, setSelected] = useState(0);

  /* The position before each move, plus the final position. An engine score
     attaches to a position, so a move's cost is the difference between the
     evaluation before it and the evaluation after it. */
  const positions = useMemo(() => [initialFen, ...moves.map((move) => move.fen)], [initialFen, moves]);

  const run = async () => {
    if (positions.length < 2) return;
    setRunning(true);
    setReviews([]);
    setScores([]);
    setProgress(0);
    setSelected(0);

    try {
      const collected: number[] = [];
      /* The engine's own first choice, per position, so "best" can mean the
         move it would have played rather than merely one that lost nothing. */
      const bestMoves: (string | null)[] = [];

      for (let i = 0; i < positions.length; i += 1) {
        const fen = positions[i];
        const result = await analyse(fen, depth);
        collected.push(toWhiteCp(result.cp, result.mate, turnOf(fen)));
        bestMoves.push(result.best);
        setProgress(Math.round(((i + 1) / positions.length) * 100));
      }

      const output: PlyReview[] = moves.map((move, index) => {
        const mover = turnOf(positions[index]);
        const before = collected[index];
        const after = collected[index + 1];
        // Positive loss means the move gave ground, whichever side played it.
        const loss = Math.max(0, mover === 'w' ? before - after : after - before);
        return {
          ply: index + 1,
          san: move.san,
          mover,
          loss,
          verdict: classifyMove(loss, {
            onlyMove: legalMoveCount(positions[index]) === 1,
            matchesBestMove: bestMoves[index] === move.uci,
          }),
          cpWhite: after,
        };
      });

      setScores(collected);
      setReviews(output);
    } finally {
      setRunning(false);
    }
  };

  const forSide = (side: 'w' | 'b') => {
    const mine = reviews.filter((review) => review.mover === side);
    if (!mine.length) return null;
    const average = mine.reduce((sum, review) => sum + review.loss, 0) / mine.length;
    const accuracy = accuracyFromLoss(average, mine.length);
    return { accuracy, rating: ratingFromAccuracy(accuracy), moves: mine.length };
  };

  const white = forSide('w');
  const black = forSide('b');
  const shownCp = scores[selected] ?? 0;

  return (
    <section className="border-2 border-ink bg-surface shadow-brut">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink px-5 py-3">
        <h2 className="text-[13px] font-bold text-ink">Full game review</h2>
        <button
          type="button"
          onClick={() => (running ? stop() : run())}
          disabled={(!ready && !error) || moves.length === 0}
          className="press border-2 border-ink bg-accent px-3.5 py-2 text-[12px] font-bold text-on-accent shadow-brut-sm disabled:opacity-40"
        >
          {error ? 'Unavailable' : running ? `Analysing ${progress}%` : 'Review game'}
        </button>
      </header>

      {error ? (
        <p className="px-5 py-4 text-[13px] text-muted">{error}</p>
      ) : reviews.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">
          {running
            ? `Position ${Math.round((progress / 100) * positions.length)} of ${positions.length} · depth ${depth}`
            : 'Run the review to label every move and rate both players.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] border-b-2 border-ink">
            <EvalBar cpWhite={shownCp} />

            <div className="grid grid-cols-2 divide-x-2 divide-line">
              {(
                [
                  ['White', white],
                  ['Black', black],
                ] as const
              ).map(([label, side]) => (
                <div key={label} className="px-4 py-3">
                  <p className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
                    {label}
                  </p>
                  <p className="mt-1 font-mono text-[22px] leading-none text-ink tabular-nums">
                    {side ? side.rating : '—'}
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted">
                    {side ? `${side.accuracy.toFixed(1)}% accuracy · ${side.moves} moves` : 'no moves'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <EvalGraph reviews={reviews} selected={selected} onSelect={setSelected} />

          <ol className="divide-y-2 divide-line">
            <li>
              <button
                type="button"
                onClick={() => setSelected(0)}
                className={`flex w-full items-center gap-3 px-5 py-2 text-left text-[12px] font-bold ${
                  selected === 0 ? 'bg-bone' : 'hover:bg-bone'
                }`}
              >
                <span className="font-mono text-muted">0</span>
                <span className="text-ink">Starting position</span>
                <span className="ml-auto font-mono text-muted tabular-nums">
                  {formatCp(scores[0] ?? 0)}
                </span>
              </button>
            </li>

            {reviews.map((review, index) => (
              <li key={review.ply}>
                <button
                  type="button"
                  onClick={() => setSelected(index + 1)}
                  className={`grid w-full grid-cols-[2.5rem_3.5rem_1fr_auto_auto] items-center gap-3 px-5 py-2.5 text-left ${
                    selected === review.ply ? 'bg-bone' : 'hover:bg-bone'
                  }`}
                >
                  <span className="font-mono text-[11px] text-muted">
                    {Math.ceil(review.ply / 2)}
                    {review.mover === 'w' ? '.' : '…'}
                  </span>
                  <span className="font-mono text-[13px] text-ink">{review.san}</span>
                  <span className="font-mono text-[12px] text-muted tabular-nums">
                    {formatCp(review.cpWhite)}
                  </span>
                  <span className="font-mono text-[11px] text-muted tabular-nums">
                    {review.loss === 0 ? '—' : `−${(review.loss / 100).toFixed(2)}`}
                  </span>
                  <span className={`badge ${VERDICT_STYLE[review.verdict]}`}>{review.verdict}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

const formatCp = (cp: number) => {
  if (Math.abs(cp) >= 9000) return cp > 0 ? 'mate' : '−mate';
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : pawns < 0 ? '' : ' '}${pawns.toFixed(2)}`;
};

/**
 * A vertical evaluation bar, white at the top.
 *
 * Vertical rather than horizontal because it sits beside the move list, and a
 * bar that runs down the page can be read while you scroll the moves — a
 * horizontal one would be off-screen by the time you reach move thirty.
 */
function EvalBar({ cpWhite }: { cpWhite: number }) {
  const share = Math.max(0.02, Math.min(0.98, (clampCp(cpWhite) + 500) / 1000));

  return (
    <div className="flex h-full min-h-32 flex-col border-r-2 border-ink bg-solid">
      <div
        className="bg-canvas transition-[height] duration-300 ease-out"
        style={{ height: `${(1 - share) * 100}%` }}
        aria-hidden="true"
      />
      <div className="flex-1 bg-solid" aria-hidden="true" />
      <span className="sr-only">Evaluation {formatCp(cpWhite)}</span>
    </div>
  );
}

/** Centipawn advantage across the game, clamped so one blunder doesn't flatten it. */
function EvalGraph({
  reviews,
  selected,
  onSelect,
}: {
  reviews: PlyReview[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const width = 600;
  const height = 64;

  const pointAt = (cpWhite: number, index: number, total: number) => {
    const x = (index / Math.max(1, total)) * width;
    const y = height / 2 - (clampCp(cpWhite) / 500) * (height / 2 - 2);
    return { x, y };
  };

  const points = reviews
    .map((review, index) => {
      const { x, y } = pointAt(review.cpWhite, index + 1, reviews.length + 1);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const cursor = pointAt(reviews[Math.max(0, selected - 1)]?.cpWhite ?? 0, selected, reviews.length + 1);

  return (
    <div className="border-b-2 border-ink px-5 py-4">
      <p className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">Advantage</p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-2 h-16 w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--color-line-strong)"
          strokeWidth="1"
        />
        <polyline points={points} fill="none" stroke="var(--color-ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx={cursor.x} cy={cursor.y} r="6" fill="var(--color-board-dark)" stroke="var(--color-ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
        <span>+5</span>
        <span>level</span>
        <span>−5</span>
      </div>
      {/* Graphic above is scrollable-by-eye; this is the control that actually
          steps the board, so every move is reachable without a mouse-drag. */}
      <input
        type="range"
        min={0}
        max={reviews.length}
        value={selected}
        onChange={(event) => onSelect(Number(event.target.value))}
        aria-label="Step through the game"
        className="mt-3 w-full accent-[var(--color-ink)]"
      />
    </div>
  );
}

'use client';

import { useEffect, useRef } from 'react';

import type { ViewOutcome } from '@/lib/chess-ui';

/**
 * The end of a game, as a dialog rather than a line of text under the board.
 *
 * Two things are going on here. The first is information: the stored result is
 * `1-0`, which tells a player nothing, so the sentence is built by
 * `outcomeFor()` from their own side of the board. The second is the win: a
 * won game gets a spray-painted burst behind the title, because the moment a
 * player waits two hours for should not arrive as a grey paragraph.
 *
 * Only a win gets the paint. A loss and a draw get the same panel with a flat
 * rule, so the celebration stays meaningful — the same reason the green badge
 * is never used decoratively.
 */
export default function GameResult({
  outcome,
  result,
  whiteName,
  blackName,
  onClose,
}: {
  outcome: ViewOutcome;
  result: string;
  whiteName: string;
  blackName: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const won = outcome.kind === 'win' && result !== '1/2-1/2';

  useEffect(() => {
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="result-scrim fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-result-title"
        aria-describedby="game-result-detail"
        onClick={(event) => event.stopPropagation()}
        className="result-card relative w-full max-w-[30rem] overflow-hidden border-2 border-ink bg-surface shadow-brut-lg"
      >
        {/* The paint. Decorative, and hidden from the accessibility tree —
            the title already says everything this draws. */}
        {won ? <Graffiti /> : null}

        <div className="relative px-5 pt-5 pb-5 sm:px-7 sm:pt-7 sm:pb-6">
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
            {won ? 'Result — win' : outcome.kind === 'draw' ? 'Result — draw' : 'Result — loss'}
          </p>

          <h2
            id="game-result-title"
            className="mt-1 text-[clamp(2.1rem,9vw,3.1rem)] leading-[0.95] font-extrabold tracking-[-0.05em] text-ink"
          >
            {outcome.title}
          </h2>

          <p id="game-result-detail" className="mt-2 text-[15px] font-medium text-ink-soft">
            {outcome.detail}
          </p>

          <div className="mt-4 border-t-2 border-line pt-3 font-mono text-[12px] text-muted">
            <span className="text-ink">{whiteName}</span>
            {' — '}
            <span className="text-ink">{blackName}</span>
            {' · '}
            {result}
          </div>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="press mt-5 flex min-h-11 w-full items-center justify-between gap-3 border-2 border-ink bg-accent px-4 py-2.5 text-[14px] font-bold text-on-accent shadow-brut-sm"
          >
            See the board
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Spray paint, drawn as SVG.
 *
 * Every value is fixed rather than random: a random burst would be a new
 * drawing on every render, which is the opposite of a mark. The strokes are
 * drawn on with `stroke-dashoffset` (see `.result-spray` in globals.css), and
 * the whole thing is skipped under `prefers-reduced-motion`.
 */
function Graffiti() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 180"
      className="pointer-events-none absolute -top-6 -right-4 h-[15rem] w-[20rem] opacity-90"
    >
      {/* Halo of spray flecks. */}
      <g fill="var(--color-accent)" opacity="0.55">
        {[
          [232, 28, 3],
          [258, 44, 2],
          [276, 26, 4],
          [246, 62, 2.5],
          [288, 58, 2],
          [214, 44, 2],
          [268, 78, 3],
          [300, 40, 2.5],
          [206, 70, 2],
          [278, 94, 2],
        ].map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>

      {/* Two crossed sweeps, the way a tag is drawn: fast, loose, wider than
          the word it sits behind. */}
      <path
        className="result-spray"
        d="M176 128 C 210 62, 246 130, 300 66"
        pathLength={1}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="14"
        strokeLinecap="round"
        opacity="0.32"
      />
      <path
        className="result-spray result-spray--slow"
        d="M196 58 C 232 116, 258 52, 292 112"
        pathLength={1}
        fill="none"
        stroke="var(--color-draw-fg)"
        strokeWidth="9"
        strokeLinecap="round"
        opacity="0.4"
      />

      {/* The underline, which is the part that reads as a signature. */}
      <path
        className="result-spray result-spray--slow"
        d="M18 156 C 74 146, 128 164, 196 150"
        pathLength={1}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
  );
}

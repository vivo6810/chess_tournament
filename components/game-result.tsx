'use client';

import { useEffect, useRef } from 'react';

import Confetti from '@/components/confetti';
import type { ViewOutcome } from '@/lib/chess-ui';

/**
 * The end of a game, as a dialog rather than a line of text under the board.
 *
 * Two things are going on here. The first is information: the stored result is
 * `1-0`, which tells a player nothing, so the sentence is built by
 * `outcomeFor()` from their own side of the board. The second is the win: a
 * won game gets confetti over the panel, because the moment a player waits two
 * hours for should not arrive as a grey paragraph.
 *
 * Only a win gets the confetti. A loss and a draw get the same panel with a
 * flat rule, so the celebration stays meaningful — the same reason the green
 * badge is never used decoratively.
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
        {/* The celebration. Decorative, and hidden from the accessibility
            tree — the title already says everything this draws. */}
        {won ? <Confetti count={38} seed={11} fall={520} /> : null}

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


'use client';

import SplitFlapText from '@/components/split-flap-text/SplitFlapText';
import { CLOCK_TILE_COUNT, formatClock, formatClockTiles } from '@/lib/time-controls';

/**
 * Under ten seconds the clock shows tenths, because that is the moment the
 * number actually carries information — the same threshold `formatClock` uses.
 */
const TENTHS_BELOW_MS = 10_000;

/**
 * The game clock, rendered as a split-flap display.
 *
 * Two decisions worth naming:
 *
 *  1. The flap face is whole seconds only. A board cannot flip ten times a
 *     second, so the tenths digit is not a tile — it sits beside the boards in
 *     a fixed-width slot that opens at ten seconds. It is always laid out, so
 *     the digits arrive without re-flowing the row.
 *
 *  2. A flip is 90ms over three intermediate glyphs, so a ticking clock lands
 *     in about a quarter of a second and rests for the remainder of the
 *     second. Running the mechanism flat out for five straight minutes is
 *     authentic and unreadable; this keeps the motion without the noise.
 */
export default function GameClock({
  ms,
  /** The player whose turn it is not. Dimmed, but still legible. */
  idle = false,
  className = '',
}: {
  ms: number;
  idle?: boolean;
  className?: string;
}) {
  const low = ms < TENTHS_BELOW_MS;
  const face = formatClockTiles(ms);
  const tenths = low ? String(Math.floor((ms % 1000) / 100)) : '';

  /* Colour is a prop rather than a class because the component writes
     `--split-flap-text-color` inline, and an inline value beats the
     stylesheet. Setting it from here is the only way the state can win. */
  const textColor = low
    ? 'var(--color-flap-alert)'
    : idle
      ? 'var(--color-flap-idle)'
      : 'var(--color-flap-fg)';

  return (
    <span className={`game-clock${low ? ' game-clock--low' : ''} ${className}`.trim()}>
      <SplitFlapText
        aria-hidden="true"
        text={face}
        padTo={CLOCK_TILE_COUNT}
        charset="numeric"
        loop={false}
        flipsPerChar={3}
        flipDuration={0.09}
        stagger={0.04}
        fontSize={20}
        gap={3}
        tileRadius={5}
        depth={0.45}
        glare={0.3}
        tileColor="var(--color-flap-bg)"
        textColor={textColor}
      />

      <span className="game-clock__tenths" aria-hidden="true">
        {tenths ? `.${tenths}` : ''}
      </span>

      {/* The only accessible copy. `role="timer"` is announced on demand
          rather than as a live region, so a screen reader is not read a new
          number every second for an hour. */}
      <span className="sr-only" role="timer">
        {formatClock(ms)} remaining
      </span>
    </span>
  );
}

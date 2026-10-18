import { useMemo, type CSSProperties } from 'react';

/**
 * Paper falling over the thing being celebrated.
 *
 * The pieces are generated from a fixed seed rather than `Math.random()`: a
 * random burst is a different drawing on every render, which is the opposite of
 * a celebration you can point at — and in a client component it would also
 * reshuffle whenever an unrelated bit of state changed. The seed makes the same
 * fall every time, so it can be computed on the server and match on the client
 * without a hydration mismatch.
 *
 * Everything is decorative: the element is hidden from the accessibility tree,
 * nothing is focusable, and `prefers-reduced-motion` removes it entirely rather
 * than freezing a screenful of paper in mid-air.
 */

type Piece = {
  left: number;
  delay: number;
  drift: number;
  spin: number;
  duration: number;
  width: number;
  height: number;
  colour: string;
};

const COLOURS = [
  'var(--color-accent)',
  'var(--color-win-fg)',
  'var(--color-draw-fg)',
  'var(--color-loss-fg)',
  'var(--color-ink)',
];

/** A tiny deterministic generator: same seed, same confetti, every time. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function build(count: number, seed: number): Piece[] {
  const next = random(seed);
  return Array.from({ length: count }, (_, index) => {
    const wide = next() > 0.55;
    return {
      left: Number((3 + next() * 94).toFixed(2)),
      delay: Number((next() * 0.9).toFixed(2)),
      drift: Math.round((next() - 0.5) * 180),
      spin: Math.round(360 + next() * 900) * (next() > 0.5 ? 1 : -1),
      duration: Number((1.9 + next() * 1.5).toFixed(2)),
      width: wide ? 9 : 5,
      height: wide ? 15 : 9,
      colour: COLOURS[Math.floor(next() * COLOURS.length) % COLOURS.length],
    };
  });
}

export default function Confetti({
  count = 34,
  seed = 7,
  fall = 640,
  className = '',
}: {
  count?: number;
  seed?: number;
  /** How far the paper travels, in pixels — the box it is clipped to. */
  fall?: number;
  className?: string;
}) {
  const pieces = useMemo(() => build(count, seed), [count, seed]);

  return (
    <div aria-hidden="true" className={`confetti ${className}`.trim()}>
      {pieces.map((piece, index) => (
        <span
          key={index}
          className={`confetti__piece ${piece.width < 6 ? 'confetti__piece--thin' : ''}`.trim()}
          style={
            {
              '--confetti-left': `${piece.left}%`,
              '--confetti-delay': `${piece.delay}s`,
              '--confetti-duration': `${piece.duration}s`,
              '--confetti-drift': `${piece.drift}px`,
              '--confetti-spin': `${piece.spin}deg`,
              '--confetti-fall': `${fall}px`,
              '--confetti-width': `${piece.width}px`,
              '--confetti-height': `${piece.height}px`,
              '--confetti-colour': piece.colour,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

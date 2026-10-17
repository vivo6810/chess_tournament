/**
 * Server-authoritative clocks.
 *
 * Deliberately imports nothing. Clock arithmetic is independent of chess rules,
 * so keeping it free of dependencies means it can be reasoned about (and tested)
 * in isolation, and it cannot accidentally pick up a bundler-only resolution
 * dependency.
 *
 * The server stores each side's remaining milliseconds, whose turn it is, and
 * the server timestamp that turn began. The client renders a locally ticking
 * estimate between updates but never submits its own elapsed time — if it did,
 * a player could simply report that they had used zero seconds.
 */

export type ClockRules = {
  mode: 'clock' | 'per_move' | 'none';
  initialMs: number;
  incrementMs: number;
};

export type ClockFields = {
  white_ms: number;
  black_ms: number;
  increment_ms: number;
  per_move_ms: number;
  turn_started_at: number;
};

export type ClockOutcome = {
  whiteMs: number;
  blackMs: number;
  flagged: 'white' | 'black' | null;
  elapsedMs: number;
};

export function settleClock(
  clock: ClockFields,
  mover: 'w' | 'b',
  nowMs: number,
  rules: ClockRules,
): ClockOutcome {
  /* Clamped because a move can arrive with a timestamp fractionally before the
     one recorded when the turn began, and a negative elapsed would hand the
     mover free time. */
  const elapsedMs = Math.max(0, nowMs - clock.turn_started_at);

  if (rules.mode === 'none') {
    /* No clock to settle, so no bank to draw down and nothing to flag. The
       turn's start stamp is still written by the move handler — it is simply
       never read, which is why an untimed game cannot be lost on time no
       matter how long a player sits on the position. */
    return {
      whiteMs: clock.white_ms,
      blackMs: clock.black_ms,
      flagged: null,
      elapsedMs,
    };
  }

  if (rules.mode === 'per_move') {
    /* Correspondence: each move gets a fresh allowance rather than drawing on a
       shared bank, so a two-day game is two days per move, not two days total. */
    const allowance = rules.initialMs;
    if (elapsedMs > allowance) {
      return {
        whiteMs: mover === 'w' ? 0 : clock.white_ms,
        blackMs: mover === 'b' ? 0 : clock.black_ms,
        flagged: mover === 'w' ? 'white' : 'black',
        elapsedMs,
      };
    }
    return {
      whiteMs: mover === 'w' ? allowance : clock.white_ms,
      blackMs: mover === 'b' ? allowance : clock.black_ms,
      flagged: null,
      elapsedMs,
    };
  }

  const bank = mover === 'w' ? clock.white_ms : clock.black_ms;
  const remaining = bank - elapsedMs;
  if (remaining <= 0) {
    return {
      whiteMs: mover === 'w' ? 0 : clock.white_ms,
      blackMs: mover === 'b' ? 0 : clock.black_ms,
      flagged: mover === 'w' ? 'white' : 'black',
      elapsedMs,
    };
  }

  // Fischer increment: unused time accumulates in the bank.
  const updated = remaining + rules.incrementMs;
  return {
    whiteMs: mover === 'w' ? updated : clock.white_ms,
    blackMs: mover === 'b' ? updated : clock.black_ms,
    flagged: null,
    elapsedMs,
  };
}

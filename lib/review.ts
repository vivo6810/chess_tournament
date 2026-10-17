/**
 * Move grading.
 *
 * Imports nothing, for the same reason `clock.ts` imports nothing: the rules
 * here are arithmetic on numbers the engine produced, they are the part most
 * worth testing, and a test that has to load `chess.js` through a bundler
 * alias to check a threshold is a test that will not run.
 */

/** Centipawn-loss thresholds used to label a move in the review. */
export const BLUNDER_CP = 200;
export const MISTAKE_CP = 100;
export const INACCURACY_CP = 50;
export const EXCELLENT_CP = 20;

export type MoveVerdict =
  | 'forced'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

/**
 * Labels a move from what it cost, plus the two facts centipawns cannot tell
 * you on their own:
 *
 *   - `forced` — there was only one legal move, so there was no decision to get
 *     wrong. Checked first on purpose: a forced move often shows a non-zero
 *     loss, because the engine's best line from the position before it was a
 *     move that was not available.
 *   - `best` — the player found the engine's own first choice. That is a
 *     stronger statement than "lost nothing", and the two are not the same
 *     thing: a quiet position can have six moves that all hold.
 *
 * Everything else falls out of the loss.
 */
export function classifyMove(
  centipawnLoss: number,
  context: { onlyMove?: boolean; matchesBestMove?: boolean } = {},
): MoveVerdict {
  if (context.onlyMove) return 'forced';
  if (context.matchesBestMove) return 'best';
  if (centipawnLoss < EXCELLENT_CP) return 'excellent';
  if (centipawnLoss < INACCURACY_CP) return 'good';
  if (centipawnLoss < MISTAKE_CP) return 'inaccuracy';
  if (centipawnLoss < BLUNDER_CP) return 'mistake';
  return 'blunder';
}

/**
 * Maps the average centipawn loss onto a 0-100 accuracy figure. The exponential
 * shape punishes the tail, so one 400cp blunder moves the number more than four
 * separate 100cp mistakes do.
 */
export function accuracyFromLoss(averageCentipawnLoss: number, moveCount: number): number {
  if (moveCount === 0) return 0;
  const volatility = Math.min(1, moveCount / 40);
  const raw = 103.1668 * Math.exp(-0.04354 * averageCentipawnLoss) - 3.1669;
  const blended = raw * (0.7 + 0.3 * volatility);
  return Math.max(0, Math.min(100, Number(blended.toFixed(1))));
}

/**
 * An approximate playing strength, from accuracy.
 *
 * This is a *description*, not a rating: it is not stored, it does not affect
 * any standings, and it says nothing about results. What it is good for is
 * turning 87.4 into something a player can hold in their head. The curve is
 * anchored on the points below and interpolated between them — accuracy is a
 * bounded score, not an Elo, so extrapolating past either end is meaningless
 * and the ends clamp instead.
 */
const RATING_ANCHORS: readonly (readonly [number, number])[] = [
  [0, 250],
  [50, 500],
  [60, 750],
  [70, 1050],
  [80, 1450],
  [85, 1750],
  [90, 2100],
  [95, 2500],
  [100, 2900],
];

export function ratingFromAccuracy(accuracy: number): number {
  const score = Math.max(0, Math.min(100, accuracy));

  for (let i = 0; i < RATING_ANCHORS.length - 1; i += 1) {
    const [lowScore, lowRating] = RATING_ANCHORS[i];
    const [highScore, highRating] = RATING_ANCHORS[i + 1];
    if (score <= highScore) {
      const span = highScore - lowScore;
      const t = span === 0 ? 0 : (score - lowScore) / span;
      return Math.round((lowRating + t * (highRating - lowRating)) / 10) * 10;
    }
  }

  return RATING_ANCHORS[RATING_ANCHORS.length - 1][1];
}

import test from 'node:test';
import assert from 'node:assert/strict';

import { settleClock, type ClockFields } from './clock.ts';
import { classifyMove, ratingFromAccuracy } from './review.ts';
import { getTimeControl } from './time-controls.ts';

const bank = (whiteMs: number, blackMs: number, startedAt: number): ClockFields => ({
  white_ms: whiteMs,
  black_ms: blackMs,
  increment_ms: 0,
  per_move_ms: 0,
  turn_started_at: startedAt,
});

const BLITZ_5_3 = getTimeControl('5+3');
const BLITZ_3_0 = getTimeControl('3+0');
const DAILY_2D = getTimeControl('2d');
const UNTIMED = getTimeControl('untimed');

test('a Fischer increment is added to the mover only', () => {
  const control = BLITZ_5_3; // 5 minutes, 3 second increment
  const outcome = settleClock(bank(300_000, 300_000, 1_000), 'w', 2_000, control);

  // Used one second, then gained the 3s increment: 300000 - 1000 + 3000.
  assert.equal(outcome.whiteMs, 302_000);
  assert.equal(outcome.blackMs, 300_000, "the opponent's clock must not move");
  assert.equal(outcome.flagged, null);
});

test('the increment does not apply to the player who flagged', () => {
  // Uses the increment control on purpose: flagging must not pay out the 3s.
  const outcome = settleClock(bank(300_000, 300_000, 0), 'w', 300_001, BLITZ_5_3);
  assert.equal(outcome.flagged, 'white');
  assert.equal(outcome.whiteMs, 0);
});

test('a move that arrives exactly on zero flags', () => {
  const outcome = settleClock(bank(10_000, 10_000, 0), 'b', 10_000, BLITZ_3_0);
  assert.equal(outcome.flagged, 'black');
});

test('a move one millisecond inside the flag is accepted', () => {
  const outcome = settleClock(bank(10_000, 10_000, 0), 'b', 9_999, BLITZ_3_0);
  assert.equal(outcome.flagged, null);
  assert.equal(outcome.blackMs, 1);
});

test('elapsed time never goes negative if the server clock steps back', () => {
  const outcome = settleClock(bank(10_000, 10_000, 5_000), 'w', 4_000, BLITZ_3_0);
  assert.equal(outcome.flagged, null);
  assert.equal(outcome.whiteMs, 10_000, 'a negative elapsed must not grant free time');
});

test('correspondence controls refresh the allowance every move', () => {
  const allowance = DAILY_2D.initialMs;
  const outcome = settleClock(bank(allowance, allowance, 0), 'w', 1_000, DAILY_2D);

  // Two days per move, not two days in total: the mover's clock resets.
  assert.equal(outcome.whiteMs, allowance);
  assert.equal(outcome.flagged, null);
});

test('exceeding a per-move allowance flags the mover', () => {
  const allowance = DAILY_2D.initialMs;
  const outcome = settleClock(bank(allowance, allowance, 0), 'w', allowance + 1, DAILY_2D);
  assert.equal(outcome.flagged, 'white');
  assert.equal(outcome.whiteMs, 0);
});

test('correspondence accounts track each side independently', () => {
  const allowance = DAILY_2D.initialMs;
  // White is nearly out of time as the turn starts; black is untouched.
  const outcome = settleClock(bank(500, allowance, 0), 'w', 400, DAILY_2D);
  assert.equal(outcome.flagged, null);
  assert.equal(outcome.whiteMs, allowance);
  assert.equal(outcome.blackMs, allowance);
});

/* ── Untimed games ────────────────────────────────────────────────
   An untimed control stores a bank of zero. If the mode were ever ignored, a
   zero bank would flag the mover on their very first move, so these are the
   tests that stand between "no time limit" and "instant loss". */

test('an untimed game does not flag on a zero bank', () => {
  const outcome = settleClock(bank(0, 0, 1_000), 'w', 2_000, UNTIMED);
  assert.equal(outcome.flagged, null);
  assert.equal(outcome.whiteMs, 0);
  assert.equal(outcome.blackMs, 0);
});

test('an untimed game survives an arbitrarily long think', () => {
  // Two days on one move, which would flag every other control in the list.
  const outcome = settleClock(bank(0, 0, 0), 'b', 2 * 86_400_000, UNTIMED);
  assert.equal(outcome.flagged, null, 'there is no clock, so there is no flag to fall');
});

test('an untimed game never pays out an increment', () => {
  const outcome = settleClock(bank(0, 0, 0), 'w', 5_000, UNTIMED);
  assert.equal(outcome.whiteMs, 0, 'with no clock there is nothing to accumulate');
});

/* ── Move verdicts ─────────────────────────────────────────────── */

test('a forced move is never called a mistake', () => {
  /* The only legal move can still show a large loss — the engine wanted
     something that was not available. Label must reflect the decision, not
     the arithmetic. */
  assert.equal(classifyMove(400, { onlyMove: true }), 'forced');
});

test('finding the engine move is called best even when it costs something', () => {
  assert.equal(classifyMove(0, { matchesBestMove: true }), 'best');
});

test('the loss ladder labels each band', () => {
  assert.equal(classifyMove(0), 'excellent');
  assert.equal(classifyMove(19), 'excellent');
  assert.equal(classifyMove(20), 'good');
  assert.equal(classifyMove(49), 'good');
  assert.equal(classifyMove(50), 'inaccuracy');
  assert.equal(classifyMove(99), 'inaccuracy');
  assert.equal(classifyMove(100), 'mistake');
  assert.equal(classifyMove(199), 'mistake');
  assert.equal(classifyMove(200), 'blunder');
  assert.equal(classifyMove(10_000), 'blunder');
});

/* ── Estimated rating ──────────────────────────────────────────── */

test('the rating estimate rises with accuracy and never leaves its range', () => {
  assert.ok(ratingFromAccuracy(100) > ratingFromAccuracy(80));
  assert.ok(ratingFromAccuracy(80) > ratingFromAccuracy(60));
  assert.ok(ratingFromAccuracy(-10) >= 250, 'below the curve clamps rather than going negative');
  assert.ok(ratingFromAccuracy(1_000) <= 2900, 'above the curve clamps rather than inventing a superhuman');
});

test('the rating estimate is reported in round tens', () => {
  for (const accuracy of [0, 12.5, 63.2, 87.9, 100]) {
    assert.equal(ratingFromAccuracy(accuracy) % 10, 0, `${accuracy}% produced a fiddly rating`);
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CATEGORY_LABEL,
  CLOCK_TILE_COUNT,
  GROUPED_TIME_CONTROLS,
  TIME_CONTROLS,
  describeTimeControl,
  formatClockTiles,
  getTimeControl,
  isTimeControlId,
  isUntimed,
  speedRating,
} from './time-controls.ts';

const UNTIMED = getTimeControl('untimed');

test('the untimed control is a real, selectable control', () => {
  /* isTimeControlId is what the create-tournament route validates against, so a
     control that is not in the list cannot be chosen — and a control in the list
     but failing this check would be rejected after the host had picked it. */
  assert.equal(isTimeControlId('untimed'), true);
  assert.equal(UNTIMED.id, 'untimed');
  assert.equal(UNTIMED.mode, 'none');
  assert.equal(isUntimed(UNTIMED), true);
  assert.equal(UNTIMED.initialMs, 0, 'an untimed game has no bank to draw on');
  assert.equal(UNTIMED.incrementMs, 0);
});

test('the untimed control is offered in the picker', () => {
  const offered = GROUPED_TIME_CONTROLS.flatMap((group) => group.controls).map((tc) => tc.id);
  assert.ok(offered.includes('untimed'), 'a control nobody can select is not a control');
  const group = GROUPED_TIME_CONTROLS.find((entry) => entry.category === 'casual');
  assert.equal(group?.label, CATEGORY_LABEL.casual);
});

test('every control declares a mode the clock knows how to settle', () => {
  for (const control of TIME_CONTROLS) {
    assert.ok(
      control.mode === 'clock' || control.mode === 'per_move' || control.mode === 'none',
      `${control.id} has mode ${control.mode}, which settleClock has no branch for`,
    );
  }
});

test('an untimed control is described in words and ranks as no speed', () => {
  assert.equal(describeTimeControl(UNTIMED), 'No time limit');
  assert.equal(speedRating(UNTIMED), 0, 'a game with no clock has no speed rating');
});

test('the split-flap face is always five tiles wide', () => {
  /* The tiles are keyed by position, so the length must not change mid-game or
     the whole display remounts. */
  for (const ms of [0, 1, 999, 1_000, 9_999, 59_999, 60_000, 300_000, 1_800_000, 99_999_999]) {
    assert.equal(formatClockTiles(ms).length, CLOCK_TILE_COUNT, `${ms}ms produced a face of the wrong width`);
  }
});

test('the split-flap face reads as minutes and seconds', () => {
  assert.equal(formatClockTiles(300_000), '05:00');
  assert.equal(formatClockTiles(299_000), '04:59');
  assert.equal(formatClockTiles(9_400), '00:09');
  assert.equal(formatClockTiles(1_800_000), '30:00');
  assert.equal(formatClockTiles(0), '00:00');
});

test('a negative or fractional bank never reaches the display', () => {
  assert.equal(formatClockTiles(-5_000), '00:00', 'a flagged clock must render as zero, not as a minus sign');
  assert.equal(formatClockTiles(1_999), '00:01', 'the face floors, it does not round up');
});

test('the face caps rather than growing an hour field', () => {
  /* Five tiles is a fixed budget. Rather than silently widening the board
     mid-game, the minutes stop at 99 — unreachable from any control offered
     here, and honest about it. */
  assert.equal(formatClockTiles(100 * 60_000), '99:00');
  assert.equal(formatClockTiles(86_400_000), '99:00');
});

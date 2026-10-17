/**
 * The single source of truth for time controls. The host picks one of
 * these ids; the server validates every game against the matching entry
 * and never trusts a duration sent from the client.
 */

export type TimeControlMode = 'clock' | 'per_move' | 'none';
export type TimeControlCategory =
  | 'bullet'
  | 'blitz'
  | 'rapid'
  | 'classical'
  | 'daily'
  | 'casual';

export type TimeControl = {
  id: string;
  /** Compact display form, e.g. "3 + 2". */
  label: string;
  /** Human name for the grouping, e.g. "Blitz". */
  category: TimeControlCategory;
  mode: TimeControlMode;
  /**
   * Starting bank per player, in ms. For per-move controls this is the per-move
   * allowance. Untimed controls carry no bank at all, so this is 0.
   */
  initialMs: number;
  /** Fischer increment added after each move, in ms. Always 0 for per-move controls. */
  incrementMs: number;
};

const MIN = 60_000;
const SEC = 1_000;
const DAY = 86_400_000;

export const CATEGORY_LABEL: Record<TimeControlCategory, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  daily: 'Correspondence',
  casual: 'Untimed',
};

export const TIME_CONTROLS: TimeControl[] = [
  { id: '1+0', label: '1 + 0', category: 'bullet', mode: 'clock', initialMs: 1 * MIN, incrementMs: 0 },
  { id: '2+1', label: '2 + 1', category: 'bullet', mode: 'clock', initialMs: 2 * MIN, incrementMs: 1 * SEC },

  { id: '3+0', label: '3 + 0', category: 'blitz', mode: 'clock', initialMs: 3 * MIN, incrementMs: 0 },
  { id: '3+2', label: '3 + 2', category: 'blitz', mode: 'clock', initialMs: 3 * MIN, incrementMs: 2 * SEC },
  { id: '5+0', label: '5 + 0', category: 'blitz', mode: 'clock', initialMs: 5 * MIN, incrementMs: 0 },
  { id: '5+3', label: '5 + 3', category: 'blitz', mode: 'clock', initialMs: 5 * MIN, incrementMs: 3 * SEC },

  { id: '10+0', label: '10 + 0', category: 'rapid', mode: 'clock', initialMs: 10 * MIN, incrementMs: 0 },
  { id: '10+5', label: '10 + 5', category: 'rapid', mode: 'clock', initialMs: 10 * MIN, incrementMs: 5 * SEC },
  { id: '15+10', label: '15 + 10', category: 'rapid', mode: 'clock', initialMs: 15 * MIN, incrementMs: 10 * SEC },

  { id: '30+0', label: '30 + 0', category: 'classical', mode: 'clock', initialMs: 30 * MIN, incrementMs: 0 },

  { id: '1d', label: '1 day / move', category: 'daily', mode: 'per_move', initialMs: 1 * DAY, incrementMs: 0 },
  { id: '2d', label: '2 days / move', category: 'daily', mode: 'per_move', initialMs: 2 * DAY, incrementMs: 0 },
  { id: '3d', label: '3 days / move', category: 'daily', mode: 'per_move', initialMs: 3 * DAY, incrementMs: 0 },

  /* No bank, no increment, and nothing to fall — the server never settles a
     clock for these games, so there is no way to lose one on time. */
  { id: 'untimed', label: 'No time limit', category: 'casual', mode: 'none', initialMs: 0, incrementMs: 0 },
];

const BY_ID = new Map(TIME_CONTROLS.map((tc) => [tc.id, tc]));

export const DEFAULT_TIME_CONTROL_ID = '5+3';

export function getTimeControl(id: string | null | undefined): TimeControl {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_TIME_CONTROL_ID)!;
}

export function isTimeControlId(id: string): boolean {
  return BY_ID.has(id);
}

/** True when the game is played without any clock at all. */
export function isUntimed(tc: TimeControl): boolean {
  return tc.mode === 'none';
}

/** Long-form phrasing, e.g. "5 minutes with a 3 second increment". */
export function describeTimeControl(tc: TimeControl): string {
  if (tc.mode === 'none') return 'No time limit';
  if (tc.mode === 'per_move') {
    const days = Math.round(tc.initialMs / DAY);
    return `${days} day${days === 1 ? '' : 's'} per move`;
  }
  const minutes = tc.initialMs / MIN;
  const base = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (!tc.incrementMs) return base;
  const seconds = tc.incrementMs / SEC;
  return `${base} with a ${seconds} second increment`;
}

/** Lichess-style stability rating used to group events by speed. */
export function speedRating(tc: TimeControl): number {
  if (tc.mode !== 'clock') return 0;
  return tc.initialMs / MIN + (40 * tc.incrementMs) / MIN / 60;
}

export const GROUPED_TIME_CONTROLS = (
  ['bullet', 'blitz', 'rapid', 'classical', 'daily', 'casual'] as TimeControlCategory[]
).map((category) => ({
  category,
  label: CATEGORY_LABEL[category],
  controls: TIME_CONTROLS.filter((tc) => tc.category === category),
}));

export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  /* Under ten seconds, show tenths — that is the moment the clock
     actually carries information. */
  if (minutes === 0 && totalSeconds < 10) {
    return `${(clamped / 1000).toFixed(1)}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Tiles in the split-flap clock face. Fixed, so the board never re-lays. */
export const CLOCK_TILE_COUNT = 5;

/**
 * The clock face as the split-flap display shows it: five tiles, `MM:SS`.
 *
 * Fixed width is the point. The tiles are keyed by position, so a face whose
 * length changed mid-game would remount every digit; minutes are therefore
 * always two digits and capped at 99, which is well clear of the longest
 * control here (30+0) and only reachable by increments in theory, if at all.
 * Sub-second precision is not in this string on purpose — the caller puts the
 * tenths digit beside the board rather than inside it.
 */
export function formatClockTiles(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.min(99, Math.floor(totalSeconds / 60));
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatAllowance(ms: number): string {
  const days = ms / DAY;
  if (days >= 1) return `${Math.round(days)}d`;
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${Math.round(ms / MIN)}m`;
}

import { Chess } from 'chess.js';

import { settleClock, type ClockFields, type ClockOutcome } from './clock';
import { getTimeControl, type TimeControl } from './time-controls';

export { settleClock };
export type { ClockFields, ClockOutcome, ClockRules } from './clock';

export type GameOver = {
  result: '1-0' | '0-1' | '1/2-1/2';
  termination:
    | 'checkmate'
    | 'stalemate'
    | 'insufficient'
    | 'fifty-move'
    | 'repetition'
    | 'timeout';
};

/** Classifies a finished position. Only board-determined endings live here. */
export function evaluatePosition(game: Chess): GameOver | null {
  if (!game.isGameOver()) return null;
  if (game.isCheckmate()) {
    return { result: game.turn() === 'w' ? '0-1' : '1-0', termination: 'checkmate' };
  }
  if (game.isStalemate()) return { result: '1/2-1/2', termination: 'stalemate' };
  if (game.isInsufficientMaterial()) return { result: '1/2-1/2', termination: 'insufficient' };
  if (game.isThreefoldRepetition()) return { result: '1/2-1/2', termination: 'repetition' };
  return { result: '1/2-1/2', termination: 'fifty-move' };
}

export type MoveAttempt = {
  from: string;
  to: string;
  promotion?: string;
};

export type ApplyMoveResult =
  | {
      ok: true;
      san: string;
      uci: string;
      fen: string;
      clock: ClockOutcome;
      over: GameOver | null;
    }
  | { ok: false; reason: string; clock?: ClockOutcome };

/**
 * Validates and applies one move. The side to move is derived from the position
 * rather than the request, so a player cannot move for their opponent by
 * claiming to be the other colour.
 */
export function applyMove(
  fen: string,
  attempt: MoveAttempt,
  clock: ClockFields,
  control: TimeControl,
  nowMs: number,
): ApplyMoveResult {
  const game = new Chess(fen);
  const mover = game.turn();

  const settled = settleClock(clock, mover, nowMs, control);
  if (settled.flagged) {
    return { ok: false, reason: 'flag', clock: settled };
  }

  let move;
  try {
    move = game.move({ from: attempt.from, to: attempt.to, promotion: attempt.promotion ?? 'q' });
  } catch {
    return { ok: false, reason: 'illegal' };
  }
  if (!move) return { ok: false, reason: 'illegal' };

  return {
    ok: true,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ''}`,
    fen: game.fen(),
    clock: settled,
    over: evaluatePosition(game),
  };
}

export function legalMoveCount(fen: string): number {
  return new Chess(fen).moves().length;
}

export function buildPgn(
  headers: Record<string, string>,
  moves: { san: string }[],
  result?: string,
): string {
  const game = new Chess();
  for (const [key, value] of Object.entries(headers)) game.setHeader(key, value);
  if (result) game.setHeader('Result', result);

  for (const move of moves) {
    try {
      game.move(move.san);
    } catch {
      break; // A corrupt tail should truncate the export, not throw.
    }
  }
  try {
    return game.pgn();
  } catch {
    return '';
  }
}

export function controlFor(timeControlId: string): TimeControl {
  return getTimeControl(timeControlId);
}

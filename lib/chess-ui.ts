import { Chess } from 'chess.js';

/**
 * Everything the board needs to know about a position that the server does not
 * need to know. Kept pure and separate from the components so the interesting
 * parts — which squares a piece can reach, what a premove queue actually means,
 * how a result reads to one particular player — can be tested without a DOM.
 */

export type Side = 'w' | 'b';

export type MoveTarget = {
  to: string;
  capture: boolean;
  /** Landing on an empty square next to a pawn: the ep capture. */
  enPassant: boolean;
  /** A pawn move that promotes — the board must ask which piece. */
  promotion: boolean;
  castle: 'king' | 'queen' | null;
};

export type MoveAttempt = {
  from: string;
  to: string;
  promotion?: string;
};

const other = (side: Side): Side => (side === 'w' ? 'b' : 'w');

/**
 * Rewrites the side-to-move field of a FEN.
 *
 * `chess.js` will only generate moves for the side whose turn it is, but a
 * player planning a premove needs to see their own pieces while it is the
 * opponent's turn. The en-passant square is cleared at the same time, because
 * it belongs to the side that just moved and would otherwise be a phantom
 * capture for the side we just handed the move to.
 */
export function withTurn(fen: string, side: Side): string {
  const fields = fen.split(' ');
  fields[1] = side;
  fields[3] = '-';
  return fields.join(' ');
}

/**
 * Every square `from` can reach, with the flags the board needs to draw the
 * right marker. Promotions arrive as four separate moves in chess.js, so they
 * are collapsed to one target — the square is the same, only the piece differs.
 */
export function targetsFrom(fen: string, from: string, side?: Side): MoveTarget[] {
  if (!/^[a-h][1-8]$/.test(from)) return [];

  let game: Chess;
  try {
    game = new Chess(side ? withTurn(fen, side) : fen);
  } catch {
    return [];
  }

  let moves: ReturnType<Chess['moves']>;
  try {
    moves = game.moves({ square: from as never, verbose: true });
  } catch {
    return [];
  }

  const bySquare = new Map<string, MoveTarget>();

  for (const move of moves as { to: string; flags: string }[]) {
    const existing = bySquare.get(move.to);
    const target: MoveTarget = {
      to: move.to,
      capture: move.flags.includes('c') || move.flags.includes('e'),
      enPassant: move.flags.includes('e'),
      promotion: move.flags.includes('p'),
      castle: move.flags.includes('k') ? 'king' : move.flags.includes('q') ? 'queen' : null,
    };

    if (!existing) {
      bySquare.set(move.to, target);
      continue;
    }

    /* Same square, different promotion piece: keep the flags, never duplicate
       the marker. */
    existing.promotion = existing.promotion || target.promotion;
    existing.capture = existing.capture || target.capture;
  }

  return [...bySquare.values()];
}

/** True when this particular from-to pair would promote a pawn. */
export function isPromotion(fen: string, from: string, to: string, side?: Side): boolean {
  return targetsFrom(fen, from, side).some((target) => target.to === to && target.promotion);
}

/**
 * Whether this exact move is legal in this exact position.
 *
 * This is the only gate a move passes through before it reaches a board, and it
 * has to be asked against the *real* position every time — never against a
 * previewed one. `chess.js` is the authority on the awkward cases, and it gets
 * them all right: a castle is refused when the king is in check, when it would
 * cross or land on an attacked square, when the rook or king has already moved
 * (the FEN has lost the right), or when the squares between them are occupied.
 * The one thing it cannot know is what the opponent is *about* to play, which is
 * exactly what a premove guesses — see `takeNextPremove`.
 */
export function isLegalMove(fen: string, from: string, to: string, promotion?: string): boolean {
  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) return false;
  try {
    const game = new Chess(fen);
    return Boolean(game.move({ from, to, promotion: promotion ?? 'q' }));
  } catch {
    return false;
  }
}

/** The position after a move, or null when the move is not legal. */
export function fenAfter(fen: string, from: string, to: string, promotion?: string): string | null {
  try {
    const game = new Chess(fen);
    const applied = game.move({ from, to, promotion: promotion ?? 'q' });
    return applied ? game.fen() : null;
  } catch {
    return null;
  }
}

/** The side that owns the piece on a square, or null when it is empty. */
export function sideOn(fen: string, square: string): Side | null {
  try {
    const piece = new Chess(fen).get(square as never);
    if (!piece) return null;
    return piece.color;
  } catch {
    return null;
  }
}

/**
 * What a tap on a square means.
 *
 * Tap-to-move is the mobile path through the board and it has to be
 * unambiguous: a tap on a marked square plays the selected move, a tap on your
 * own piece selects it (tapping it again lets go), and a tap anywhere else
 * clears the selection rather than leaving a ring on a piece you have already
 * given up on.
 */
export type TapOutcome =
  | { type: 'play'; from: string; to: string }
  | { type: 'select'; square: string }
  | { type: 'deselect' };

export function resolveTap(params: {
  fen: string;
  square: string;
  side: Side;
  selected: string | null;
  targets: MoveTarget[];
}): TapOutcome {
  const { fen, square, side, selected, targets } = params;

  if (selected && targets.some((target) => target.to === square)) {
    return { type: 'play', from: selected, to: square };
  }

  if (sideOn(fen, square) === side) {
    return selected === square ? { type: 'deselect' } : { type: 'select', square };
  }

  return { type: 'deselect' };
}

/**
 * What a finished drag means.
 *
 * A finger that drifts a few pixels while tapping can start and end a drag on
 * the square it picked up from. That is not a move — it is the tap the player
 * meant, and treating it as a move would either do nothing or, worse, play a
 * piece one square sideways. Dropping off the board is likewise nothing.
 */
export type DropOutcome =
  | { type: 'move'; from: string; to: string }
  | { type: 'tap'; square: string }
  | { type: 'ignore' };

export function resolveDrop(source: string, target: string | null): DropOutcome {
  if (!target || !/^[a-h][1-8]$/.test(source)) return { type: 'ignore' };
  if (target === source) return { type: 'tap', square: source };
  return { type: 'move', from: source, to: target };
}

/** How long a second report of the same square counts as the same tap. */
export const TAP_ECHO_MS = 450;

/**
 * Whether this tap is the browser reporting a tap we have already handled.
 *
 * One physical tap can reach the board twice: a finger that drifts a couple of
 * pixels starts and ends a one-square drag, and the browser then fires a click
 * on the same square. Handled naively the pair selects a piece and immediately
 * lets go of it — a board that appears not to respond at all — and on a marked
 * square it would submit the same move twice, the second of which the server
 * rejects. A repeat of the same square inside a few hundred milliseconds is
 * always an echo, never a player changing their mind.
 */
export function isTapEcho(
  previous: { square: string; at: number } | null,
  square: string,
  at: number,
  windowMs: number = TAP_ECHO_MS,
): boolean {
  if (!previous) return false;
  const delta = at - previous.at;
  return previous.square === square && delta >= 0 && delta <= windowMs;
}

/** The king's square for a side, for the mated-king rotation. */
export function kingSquare(fen: string, side: Side): string | null {
  try {
    const board = new Chess(fen).board();
    for (const row of board) {
      for (const square of row) {
        if (square && square.type === 'k' && square.color === side) return square.square;
      }
    }
  } catch {
    // An unparseable position simply has no king to rotate.
  }
  return null;
}

/**
 * The position a premove queue implies.
 *
 * A premove is a guess: you move while the opponent is thinking, so their reply
 * is unknown. This replays your queued moves and hands the move back to you
 * after each one, which is exactly the assumption the queue is built on and
 * what lets the second premove be planned against the first.
 */
export function premoveFen(fen: string, queue: MoveAttempt[], side: Side): string {
  if (queue.length === 0) return fen;

  let current = new Chess(fen);
  for (const move of queue) {
    try {
      current = new Chess(withTurn(current.fen(), side));
      const applied = current.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion ?? 'q',
      });
      if (!applied) return current.fen();
    } catch {
      return current.fen();
    }
  }

  return withTurn(current.fen(), other(side));
}

/**
 * What a premove queue means once the opponent's reply has actually arrived.
 *
 * A premove is a guess made while the opponent is thinking, so it is planned
 * against a position they have not answered yet. When their reply lands, the
 * head of the queue has to be judged again — in the real position. This is the
 * whole safety property of premoves, and it is the thing that goes wrong when a
 * queued castle is played even though the reply took it away: an enemy piece
 * landing on a square the king has to cross, a check, or the loss of the right
 * itself all make the move illegal, and the queue must be dropped rather than
 * half-played.
 *
 * `illegal` is not an error state — it is the expected outcome of a guess that
 * did not come off, and the caller clears the queue and says so.
 */
export type PremoveStep =
  | { status: 'empty' }
  | { status: 'illegal' }
  | { status: 'play'; move: MoveAttempt; rest: MoveAttempt[]; fen: string };

export function takeNextPremove(fen: string, queue: MoveAttempt[]): PremoveStep {
  if (queue.length === 0) return { status: 'empty' };

  const [move, ...rest] = queue;
  const next = fenAfter(fen, move.from, move.to, move.promotion);
  if (!next) return { status: 'illegal' };

  return { status: 'play', move, rest, fen: next };
}

export type OutcomeKind = 'win' | 'loss' | 'draw';

export type ViewOutcome = {
  kind: OutcomeKind;
  title: string;
  detail: string;
};

const TERMINATION_DETAIL: Record<string, string> = {
  checkmate: 'Checkmate',
  resignation: 'Resignation',
  timeout: 'Flag fall',
  stalemate: 'Stalemate — no legal moves',
  agreement: 'Draw by agreement',
  insufficient: 'Insufficient material',
  repetition: 'Threefold repetition',
  'fifty-move': 'Fifty-move rule',
};

/**
 * How a result reads to *this* player. The stored result is written from
 * white's point of view (`1-0`), which is meaningless on a results screen;
 * "You won" is the only sentence a player actually wants.
 *
 * A spectator (`viewer: null`) has no side to win with, so the same panel
 * names the winner instead of addressing the reader.
 */
export function outcomeFor(
  result: string | null,
  termination: string | null,
  viewer: Side | null,
): ViewOutcome | null {
  if (!result) return null;

  const detail = TERMINATION_DETAIL[termination ?? ''] ?? 'Game over';

  if (result === '1/2-1/2') {
    return { kind: 'draw', title: 'Draw', detail };
  }

  const whiteWon = result === '1-0';

  if (viewer == null) {
    return { kind: 'win', title: whiteWon ? 'White won' : 'Black won', detail };
  }

  const viewerWon = whiteWon === (viewer === 'w');

  return {
    kind: viewerWon ? 'win' : 'loss',
    title: viewerWon ? 'You won' : 'You lost',
    detail,
  };
}

/**
 * The king that has to fall over on the board, or null.
 *
 * Only checkmate topples a king: a resignation or a flag fall leaves a
 * perfectly healthy king standing, and rotating it in that case would be a
 * lie about the position. The loser is the side that is *to move* in a mated
 * position, which is why this reads the FEN rather than the result string.
 */
export function matedSide(fen: string, termination: string | null): Side | null {
  if (termination !== 'checkmate') return null;
  try {
    const game = new Chess(fen);
    if (!game.isCheckmate()) return null;
    return game.turn();
  } catch {
    return null;
  }
}

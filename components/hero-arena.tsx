'use client';

import { Chess } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Chessboard, defaultPieces, type PieceRenderObject } from 'react-chessboard';

import Confetti from '@/components/confetti';
import {
  fenAfter,
  isLegalMove,
  isTapEcho,
  kingSquare,
  matedSide,
  resolveDrop,
  resolveTap,
  sideOn,
  takeNextPremove,
  targetsFrom,
  withTurn,
  type MoveAttempt,
  type MoveTarget,
  type Side,
} from '@/lib/chess-ui';
import { useEngine } from '@/lib/use-engine';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Shallow on purpose: the point is an instant reply, not a correct one. */
const DEPTH = 10;

/** A queue longer than this is not a plan, it is a script. */
const MAX_PREMOVES = 5;

/**
 * Legal destinations, drawn in green.
 *
 * A quiet move is a dot and a capture is a ring, both with a one-pixel ink rim.
 * The rim is not decoration: the marker sits on both square colours, and green
 * alone is a different marker on cream than it is on a shadowed square.
 */
const HINT_DOT: CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at 50% 50%, var(--color-move-hint) 0 16%, var(--color-ink) 17% 20%, transparent 21%)',
};
const HINT_RING: CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at 50% 50%, transparent 0 35%, var(--color-move-hint) 36% 47%, var(--color-ink) 48% 52%, transparent 53%)',
};

/**
 * The landing page's real board.
 *
 * This is the same `react-chessboard` and the same Stockfish build the
 * tournament games use, not a picture of one — so the first thing a visitor
 * does on this site is play a move against the engine they will meet later.
 *
 * It is played two ways, because a phone has no drag. **Click to move** is the
 * primary path: click one of your pieces and every square it can legally reach
 * lights up green, click one of those and the move is played. Illegal
 * destinations are not marked at all, so the marker set *is* the legal move
 * list. Dragging still works for anyone who reaches for it.
 *
 * While Stockfish is thinking you can queue **premoves**. A premove is a guess
 * about its reply, so it is planned against a position it has not answered yet
 * and must be judged again the moment the reply lands — see `takeNextPremove` in
 * lib/chess-ui. A queued castle that the reply has taken away (a knight landing
 * on a square the king crosses, a discovered check, a lost castling right) is
 * dropped rather than played, and the queue shows as dashed outlines until it
 * actually fires, so the board never shows a move that did not happen.
 *
 * The side is drawn at random rather than picked, and the draw happens in an
 * effect rather than in the initial state. That is deliberate: a random value
 * in the first render would differ between the server HTML and the client, and
 * React would throw the markup away to fix it. Drawing after mount keeps the
 * served HTML deterministic and makes the flip a visible piece of the page's
 * behaviour instead of a hydration warning.
 */
export default function HeroArena() {
  const { ready, error, analyse } = useEngine();
  const [fen, setFen] = useState(START_FEN);
  const [userColor, setUserColor] = useState<Side>('w');
  const [drawn, setDrawn] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [queue, setQueue] = useState<MoveAttempt[]>([]);
  /* Guards against a reply landing after the player has reset the board. */
  const positionRef = useRef(0);
  /* The last square a tap was handled for. One tap can arrive twice — a drag
     that ended where it began, and the click the browser fires after it. */
  const lastTapRef = useRef<{ square: string; at: number } | null>(null);

  const game = useMemo(() => new Chess(fen), [fen]);
  const turn: Side = game.turn();
  const isUsersTurn = turn === userColor;
  const over = game.isGameOver();
  const mated = over ? matedSide(fen, 'checkmate') : null;
  const userWon = mated != null && mated !== userColor;

  const targets = useMemo<MoveTarget[]>(
    () => (selected ? targetsFrom(fen, selected, isUsersTurn ? undefined : userColor) : []),
    [fen, isUsersTurn, selected, userColor],
  );

  /* Draw a side once, after mount. There is no redraw control: the point of
     the section is a game, and a button for "which colour am I" turns it into
     a settings screen. */
  const drawSide = useCallback(() => {
    setUserColor(Math.random() < 0.5 ? 'w' : 'b');
    setDrawn(true);
  }, []);

  useEffect(() => {
    drawSide();
  }, [drawSide]);

  const reset = useCallback(() => {
    positionRef.current += 1;
    setFen(START_FEN);
    setNote(null);
    setThinking(false);
    setSelected(null);
    setQueue([]);
    lastTapRef.current = null;
  }, []);

  /* ── The engine answers ────────────────────────────────────────
     It only ever runs when it is its own turn, so a reset or a fast player
     move cannot make it answer twice. */
  useEffect(() => {
    if (!drawn || !ready || over || isUsersTurn) return undefined;

    const token = positionRef.current;
    let cancelled = false;
    setThinking(true);

    analyse(fen, DEPTH)
      .then((result) => {
        if (cancelled || token !== positionRef.current) return;

        const best = result.best;
        if (!best || best === '0000') {
          setNote('Stockfish has no move.');
          return;
        }

        const next = fenAfter(fen, best.slice(0, 2), best.slice(2, 4), best[4]);
        if (!next) {
          setNote('Stockfish offered a move this board rejected.');
          return;
        }
        setFen(next);
      })
      .finally(() => {
        if (!cancelled && token === positionRef.current) setThinking(false);
      });

    return () => {
      cancelled = true;
      setThinking(false);
    };
  }, [fen, drawn, ready, over, isUsersTurn, analyse]);

  /* ── Firing the queue ─────────────────────────────────────────
     One premove per reply, and it is judged in the position that is actually
     on the board now — not in the one it was planned in. If the guess did not
     come off, the whole plan is dropped: half a sequence is worse than none. */
  useEffect(() => {
    if (!drawn || over || !isUsersTurn || queue.length === 0) return;

    const step = takeNextPremove(fen, queue);

    if (step.status === 'illegal') {
      setQueue([]);
      setSelected(null);
      setNote('Stockfish took that premove away, so it was dropped.');
      return;
    }

    if (step.status === 'play') {
      setQueue(step.rest);
      setFen(step.fen);
    }
  }, [drawn, fen, isUsersTurn, over, queue]);

  const play = useCallback(
    (from: string, to: string) => {
      setSelected(null);
      setNote(null);
      if (over) return;

      if (isUsersTurn) {
        const next = fenAfter(fen, from, to);
        if (!next) {
          setNote('That move is not legal.');
          return;
        }
        setFen(next);
        return;
      }

      /* A premove is planned with our own side to move — the en-passant square
         of the reply we are guessing at would be a phantom capture. */
      if (!isLegalMove(withTurn(fen, userColor), from, to)) {
        setNote('That move will not be legal.');
        return;
      }

      if (queue.length >= MAX_PREMOVES) {
        setNote(`That is ${MAX_PREMOVES} premoves — clear one to plan further.`);
        return;
      }

      setQueue((current) => [...current, { from, to }]);
    },
    [fen, isUsersTurn, over, queue.length, userColor],
  );

  const handleTap = useCallback(
    (square: string) => {
      if (over) return;

      const at = Date.now();
      if (isTapEcho(lastTapRef.current, square, at)) return;
      lastTapRef.current = { square, at };

      const tap = resolveTap({ fen, square, side: userColor, selected, targets });

      if (tap.type === 'play') play(tap.from, tap.to);
      else if (tap.type === 'select') setSelected(tap.square);
      else setSelected(null);
    },
    [fen, over, play, selected, targets, userColor],
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
      if (over) return false;

      const drop = resolveDrop(sourceSquare, targetSquare);
      if (drop.type === 'ignore') return false;

      /* A drag that ended on the square it started from is a tap that drifted,
         not a move. */
      if (drop.type === 'tap') {
        handleTap(drop.square);
        return false;
      }

      if (sideOn(fen, drop.from) !== userColor) return false;

      play(drop.from, drop.to);
      /* A premove has not been played — it has been planned. Snapping the piece
         back is the honest picture; the dashed outline shows the plan. */
      return isUsersTurn;
    },
    [fen, handleTap, isUsersTurn, over, play, userColor],
  );

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    const paint = (square: string, style: CSSProperties) => {
      styles[square] = { ...(styles[square] ?? {}), ...style };
    };

    /* `game` is built from a FEN, which carries no move list, so there is no
       last move to mark here — the check ring is the only state this paints. */
    if (!over && game.isCheck()) {
      const king = kingSquare(fen, turn);
      if (king) paint(king, { boxShadow: 'inset 0 0 0 4px var(--color-loss-fg)' });
    }

    /* Queued premoves, dashed so they never read as a played move. */
    for (const move of queue) {
      paint(move.from, { outline: '2px dashed var(--color-accent)', outlineOffset: '-4px' });
      paint(move.to, { outline: '2px dashed var(--color-accent)', outlineOffset: '-4px' });
    }

    if (selected) paint(selected, { boxShadow: 'inset 0 0 0 4px var(--color-move-hint)' });

    for (const target of targets) {
      paint(target.to, target.capture ? HINT_RING : HINT_DOT);
    }

    return styles;
  }, [fen, game, over, queue, selected, targets, turn]);

  const pieces = useMemo<PieceRenderObject>(() => {
    if (!mated) return defaultPieces;
    const key = mated === 'w' ? 'wK' : 'bK';
    const Base = defaultPieces[key];
    return {
      ...defaultPieces,
      [key]: (props) => (
        <span className={`fallen-king fallen-king--${mated === 'w' ? 'white' : 'black'}`}>
          <Base {...props} />
        </span>
      ),
    };
  }, [mated]);

  const status = over
    ? game.isCheckmate()
      ? userWon
        ? 'Checkmate — you beat Stockfish.'
        : 'Checkmate — Stockfish wins.'
      : game.isStalemate()
        ? 'Stalemate.'
        : 'Drawn.'
    : thinking
      ? 'Stockfish is thinking…'
      : isUsersTurn
        ? selected
          ? 'Click a green square to move.'
          : queue.length > 0
            ? 'Playing your premove…'
            : 'Your move. Click a piece to see where it can go.'
        : queue.length > 0
          ? `${queue.length} premove${queue.length === 1 ? '' : 's'} queued — waiting for Stockfish.`
          : 'Stockfish to move.';

  return (
    <div className="relative overflow-hidden border-2 border-ink bg-surface p-2.5 shadow-brut-lg sm:p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] font-bold text-ink">
          <span className="badge bg-draw-bg text-draw-fg">
            {drawn ? `You: ${userColor === 'w' ? 'White' : 'Black'}` : 'Drawing…'}
          </span>
          <span className="text-muted" aria-live="polite">
            {status}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="press border-2 border-ink bg-solid px-3 py-1.5 text-[12px] font-bold text-on-solid shadow-brut-sm"
          >
            Reset
          </button>
        </div>
      </div>

      {/* No frame of its own: the card's border is the frame, and a second one
          around the board only steals squares from the pieces. */}
      <div className="relative mt-3">
        <Chessboard
          options={{
            id: 'arbiter-landing-board',
            position: fen,
            boardOrientation: userColor === 'w' ? 'white' : 'black',
            pieces,
            onPieceDrop,
            onSquareClick: ({ square }: { square: string }) => handleTap(square),
            allowDragging: !over,
            canDragPiece: ({ piece }) => piece.pieceType.charAt(0) === userColor,
            /* A finger always moves a few pixels while tapping. Without a
               little slack every tap on a piece became a one-square drag. */
            dragActivationDistance: 10,
            animationDurationInMs: 180,
            showNotation: true,
            squareStyles,
            darkSquareStyle: { backgroundColor: 'var(--color-board-dark)' },
            lightSquareStyle: { backgroundColor: 'var(--color-board-light)' },
          }}
        />

        {userWon ? <Confetti count={46} fall={520} /> : null}
      </div>

      <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
        {error
          ? error
          : ready
            ? `Stockfish 19 · depth ${DEPTH} · you play ${userColor === 'w' ? 'white' : 'black'}`
            : 'Starting Stockfish…'}
      </p>

      {note ? <p className="mt-1 text-[12px] text-loss-fg">{note}</p> : null}
    </div>
  );
}

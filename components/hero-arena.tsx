'use client';

import { Chess } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';

import { useEngine } from '@/lib/use-engine';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Shallow on purpose: the point is an instant reply, not a correct one. */
const DEPTH = 10;

type Side = 'w' | 'b';

/**
 * The landing page's real board.
 *
 * This is the same `react-chessboard` and the same Stockfish build the
 * tournament games use, not a picture of one — so the first thing a visitor
 * does on this site is play a move against the engine they will meet later.
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
  /* Guards against a reply landing after the player has reset the board. */
  const positionRef = useRef(0);

  const game = useMemo(() => new Chess(fen), [fen]);
  const turn: Side = game.turn();
  const isUsersTurn = turn === userColor;
  const over = game.isGameOver();

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
  }, []);

  /* The engine plays the other side. It only ever runs when it is its own turn,
     so a reset or a fast player move cannot make it answer twice. */
  useEffect(() => {
    if (!drawn || !ready || over || isUsersTurn) return undefined;

    const token = positionRef.current;
    let cancelled = false;
    setThinking(true);

    analyse(fen, DEPTH)
      .then((result) => {
        if (cancelled || token !== positionRef.current) return;

        const best = result.best;
        const board = new Chess(fen);
        if (!best || best === '0000') {
          setNote('Stockfish has no move.');
          return;
        }

        try {
          board.move({
            from: best.slice(0, 2),
            to: best.slice(2, 4),
            promotion: best[4] ?? 'q',
          });
          setFen(board.fen());
        } catch {
          setNote('Stockfish offered a move this board rejected.');
        }
      })
      .finally(() => {
        if (!cancelled && token === positionRef.current) setThinking(false);
      });

    return () => {
      cancelled = true;
      setThinking(false);
    };
  }, [fen, drawn, ready, over, isUsersTurn, analyse]);

  const onPieceDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!isUsersTurn || over || !targetSquare) return false;

    const board = new Chess(fen);
    try {
      board.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
    } catch {
      return false;
    }
    setFen(board.fen());
    return true;
  };

  const status = over
    ? game.isCheckmate()
      ? `${turn === 'w' ? 'Black' : 'White'} mates.`
      : 'Drawn.'
    : thinking
      ? 'Stockfish is thinking…'
      : isUsersTurn
        ? 'Your move.'
        : 'Stockfish to move.';

  return (
    <div className="border-2 border-ink bg-surface p-4 shadow-brut-lg sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] font-bold text-ink">
          <span className="badge bg-draw-bg text-draw-fg">{drawn ? `You: ${userColor === 'w' ? 'White' : 'Black'}` : 'Drawing…'}</span>
          <span className="text-muted">{status}</span>
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

      <div className="mt-4 border-2 border-ink">
        <Chessboard
          options={{
            id: 'arbiter-landing-board',
            position: fen,
            boardOrientation: userColor === 'w' ? 'white' : 'black',
            onPieceDrop,
            allowDragging: isUsersTurn && !over,
            animationDurationInMs: 180,
            showNotation: true,
            darkSquareStyle: { backgroundColor: 'var(--color-board-dark)' },
            lightSquareStyle: { backgroundColor: 'var(--color-board-light)' },
          }}
        />
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

'use client';

import { Chess } from 'chess.js';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Chessboard, defaultPieces, type PieceRenderObject } from 'react-chessboard';

import EnginePanel from '@/components/engine-panel';
import GameClock from '@/components/game-clock';
import GameResult from '@/components/game-result';
import GameReview, { type ReviewMove } from '@/components/game-review';
import {
  isPromotion,
  isTapEcho,
  kingSquare,
  matedSide,
  outcomeFor,
  premoveFen,
  resolveDrop,
  resolveTap,
  targetsFrom,
  type MoveAttempt,
  type Side,
} from '@/lib/chess-ui';
import { formatAllowance, type TimeControl } from '@/lib/time-controls';

export type GameState = {
  game: {
    id: number;
    fen: string;
    status: 'active' | 'finished';
    result: string | null;
    termination: string | null;
    timeControl: TimeControl;
    /** Position before the first move — the review needs this as its anchor. */
    startFen: string;
    /** The standing draw offer, by colour. A draw needs both players. */
    drawOffer: 'white' | 'black' | null;
    moves: ReviewMove[];
    white: { playerId: number; name: string };
    black: { playerId: number; name: string };
  };
  clock: {
    whiteMs: number;
    blackMs: number;
    incrementMs: number;
    perMoveMs: number;
    turnStartedAt: number;
    serverNow: number;
  };
  seats: { seated: boolean; isWhite: boolean };
};

/** A queue longer than this is not a plan, it is a script. */
const MAX_PREMOVES = 5;

/** Quiet-move dot and capture ring, drawn onto the square itself. */
const DOT: CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at 50% 50%, var(--color-accent) 0 15%, transparent 16%)',
};
const RING: CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at 50% 50%, transparent 0 39%, var(--color-accent) 40% 48%, transparent 49%)',
};

const parseTurn = (fen: string): Side => (fen.split(' ')[1] === 'w' ? 'w' : 'b');

function inCheck(fen: string): boolean {
  try {
    return new Chess(fen).isCheck();
  } catch {
    return false;
  }
}

export default function GameBoard({
  initial,
  canSettle,
  pollMs = 1200,
}: {
  initial: GameState;
  canSettle: boolean;
  pollMs?: number;
}) {
  const [state, setState] = useState<GameState>(initial);
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [queue, setQueue] = useState<MoveAttempt[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: string;
    to: string;
    premove: boolean;
  } | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  /* The server hands back its own timestamp with every poll, so the client can
     render a smooth ticking clock without ever being the source of truth. */
  const offsetRef = useRef(initial.clock.serverNow - Date.now());
  /* The position a premove was fired from. The next premove may not leave the
     queue until the server has answered the last one — otherwise two clicks
     could both be validated against the same position. */
  const firedFromRef = useRef<string | null>(null);
  /* The last square a tap was handled for. One physical tap can arrive twice —
     a drag that ended where it began, and the click the browser fires after
     it — and handling both would select a piece and immediately let go of it,
     which is exactly what a dead board feels like. */
  const lastTapRef = useRef<{ square: string; at: number } | null>(null);

  /* The last payload the server sent, so an unchanged one can be thrown away.
     The poll runs whether or not anything happened, and a spectator watching a
     quiet position would otherwise rebuild the whole board every 1.2 seconds to
     draw exactly the same pixels. */
  const lastPollRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/games/${initial.game.id}`, { cache: 'no-store' });
      if (!response.ok) return;
      const next = (await response.json()) as GameState;

      /* The offset is always taken: it is what keeps the local clock honest
         against the server's, and it costs no render. */
      offsetRef.current = next.clock.serverNow - Date.now();

      const fingerprint = JSON.stringify({ ...next, clock: { ...next.clock, serverNow: 0 } });
      if (fingerprint === lastPollRef.current) {
        setOptimisticFen(null);
        return;
      }

      lastPollRef.current = fingerprint;
      setState(next);
      setOptimisticFen(null);
    } catch {
      // A dropped poll is not worth surfacing; the next one will reconnect.
    }
  }, [initial.game.id]);

  useEffect(() => {
    const poll = setInterval(refresh, pollMs);
    return () => clearInterval(poll);
  }, [refresh, pollMs]);

  const { game, clock, seats } = state;
  const serverFen = game.fen;
  const turn = parseTurn(serverFen);
  const finished = game.status === 'finished';

  /* A spectator is not black. The old default handed every non-seated viewer
     the board from black's side, which reads as a flipped board for no reason. */
  const viewerSide: Side | null = seats.seated ? (seats.isWhite ? 'w' : 'b') : null;
  const orientation: 'white' | 'black' = viewerSide === 'b' ? 'black' : 'white';
  const myTurn = viewerSide != null && turn === viewerSide;
  const canMove = viewerSide != null && !finished;

  /* Premoves are drawn immediately: the queue is replayed on top of the real
     position so a player can plan two or three moves deep while waiting. */
  const boardFen = useMemo(
    () => optimisticFen ?? premoveFen(serverFen, queue, viewerSide ?? 'w'),
    [optimisticFen, serverFen, queue, viewerSide],
  );

  const targets = useMemo(
    () => (selected ? targetsFrom(boardFen, selected, myTurn ? undefined : (viewerSide ?? undefined)) : []),
    [boardFen, selected, myTurn, viewerSide],
  );

  /* Selection belongs to a position. The moment the server hands us a new one
     the old selection is meaningless, and a stale ring on a square that no
     longer holds our piece is worse than no ring at all. */
  useEffect(() => {
    setSelected(null);
  }, [serverFen]);

  useEffect(() => {
    if (!finished) return;
    setSelected(null);
    setQueue([]);
  }, [finished]);

  const submit = useCallback(
    async (from: string, to: string, promotion?: string) => {
      setError(null);

      /* Validate locally first so an illegal drag is rejected by the board
         rather than flashing and being undone by the next poll. */
      const probe = new Chess(serverFen);
      try {
        probe.move({ from, to, promotion: promotion ?? 'q' });
      } catch {
        return false;
      }

      setOptimisticFen(probe.fen());

      const response = await fetch(`/api/games/${game.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, promotion }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Move rejected.' }));
        setError(payload.error ?? 'Move rejected.');
        setOptimisticFen(null);
        await refresh();
        return false;
      }

      await refresh();
      return true;
    },
    [game.id, refresh, serverFen],
  );

  const enqueue = useCallback(
    (move: MoveAttempt) => {
      setError(null);
      if (queue.length >= MAX_PREMOVES) {
        setNotice(`That is ${MAX_PREMOVES} premoves — clear one to plan further.`);
        return;
      }
      setNotice(null);
      setQueue((current) => [...current, move]);
    },
    [queue.length],
  );

  const play = useCallback(
    (from: string, to: string) => {
      setSelected(null);
      if (!canMove) return;

      /* The board the move is judged against is the *previewed* one, so the
         second premove is checked after the first, not against the position
         before it. */
      const promoting = isPromotion(
        boardFen,
        from,
        to,
        myTurn ? undefined : (viewerSide ?? undefined),
      );

      if (promoting) {
        setPendingPromotion({ from, to, premove: !myTurn });
        return;
      }

      if (myTurn) void submit(from, to);
      else enqueue({ from, to });
    },
    [boardFen, canMove, enqueue, myTurn, submit, viewerSide],
  );

  /* ── Firing the queue ─────────────────────────────────────────
     One premove per server position. When the opponent answers, the server
     fen changes and the next queued move is validated and sent; if it is no
     longer legal (the opponent played something unexpected) the rest of the
     plan is dropped rather than half-executed. */
  useEffect(() => {
    if (!canMove || !myTurn || queue.length === 0) return;
    if (firedFromRef.current === serverFen) return;

    const next = queue[0];
    const probe = new Chess(serverFen);
    let legal = false;
    try {
      legal = Boolean(probe.move({ from: next.from, to: next.to, promotion: next.promotion ?? 'q' }));
    } catch {
      legal = false;
    }

    if (!legal) {
      setQueue([]);
      setSelected(null);
      setError('Your premove is no longer legal — the queue was cleared.');
      return;
    }

    firedFromRef.current = serverFen;
    setQueue((current) => current.slice(1));
    void submit(next.from, next.to, next.promotion);
  }, [canMove, myTurn, queue, serverFen, submit]);

  /* ── Tap to move ───────────────────────────────────────────────
     Clicking a marked square plays the move; clicking one of your own pieces
     selects it. This is the whole tap-to-move path that mobile players get
     instead of a drag across a 32px square. The decision itself is
     `resolveTap` in lib/chess-ui so it can be tested without a DOM. */
  const handleTap = useCallback(
    (square: string) => {
      if (!canMove || finished || !viewerSide) return;

      /* Drop the echo of a tap that has already been handled. */
      const at = Date.now();
      if (isTapEcho(lastTapRef.current, square, at)) return;
      lastTapRef.current = { square, at };

      const tap = resolveTap({
        fen: boardFen,
        square,
        side: viewerSide,
        selected,
        targets,
      });

      if (tap.type === 'play') play(tap.from, tap.to);
      else if (tap.type === 'select') setSelected(tap.square);
      else setSelected(null);
    },
    [boardFen, canMove, finished, play, selected, targets, viewerSide],
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
      if (!canMove) return false;

      const drop = resolveDrop(sourceSquare, targetSquare);
      if (drop.type === 'ignore') return false;

      /* A drag that ended on the square it started from is a tap that drifted,
         not a move. */
      if (drop.type === 'tap') {
        handleTap(drop.square);
        return false;
      }

      const promoting = isPromotion(
        boardFen,
        drop.from,
        drop.to,
        myTurn ? undefined : (viewerSide ?? undefined),
      );
      if (promoting) {
        setPendingPromotion({ from: drop.from, to: drop.to, premove: !myTurn });
        return false;
      }

      play(drop.from, drop.to);
      return true;
    },
    [boardFen, canMove, handleTap, myTurn, play, viewerSide],
  );

  const onSquareClick = useCallback(
    ({ square }: { square: string }) => handleTap(square),
    [handleTap],
  );

  const choosePromotion = useCallback(
    (piece: string) => {
      if (!pendingPromotion) return;
      const { from, to, premove } = pendingPromotion;
      setPendingPromotion(null);
      if (premove) enqueue({ from, to, promotion: piece });
      else void submit(from, to, piece);
    },
    [enqueue, pendingPromotion, submit],
  );

  const settle = useCallback(
    async (action: string, side?: 'white' | 'black') => {
      setError(null);
      const response = await fetch(`/api/games/${game.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, side }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Action rejected.' }));
        setError(payload.error ?? 'Action rejected.');
        return;
      }
      setConfirmResign(false);
      await refresh();
    },
    [game.id, refresh],
  );

  /* ── The end of the game ──────────────────────────────────────
     The dialog opens once per result, keyed on the result and the length of
     the game, so closing it does not make it spring back on the next poll —
     but a rematch or a re-opened game still announces itself. */
  const outcome = outcomeFor(game.result, game.termination, viewerSide);
  const fingerprint = `${game.id}:${game.result ?? ''}:${game.moves.length}`;
  const resultOpen = finished && outcome != null && dismissed !== fingerprint;

  const fallenSide = finished ? matedSide(game.fen, game.termination) : null;
  const pieces = useMemo<PieceRenderObject>(() => {
    if (!fallenSide) return defaultPieces;
    const key = fallenSide === 'w' ? 'wK' : 'bK';
    const Base = defaultPieces[key];
    return {
      ...defaultPieces,
      [key]: (props) => (
        <span className={`fallen-king fallen-king--${fallenSide === 'w' ? 'white' : 'black'}`}>
          <Base {...props} />
        </span>
      ),
    };
  }, [fallenSide]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    const paint = (square: string, style: CSSProperties) => {
      styles[square] = { ...(styles[square] ?? {}), ...style };
    };

    /* The last move, so a player who looks away can see what happened. */
    const last = game.moves[game.moves.length - 1];
    if (last && last.uci.length >= 4) {
      for (const square of [last.uci.slice(0, 2), last.uci.slice(2, 4)]) {
        paint(square, { boxShadow: 'inset 0 0 0 3px var(--color-line-strong)' });
      }
    }

    /* Queued premoves, dashed so they never read as a played move. */
    for (const move of queue) {
      paint(move.from, { outline: '2px dashed var(--color-accent)', outlineOffset: '-4px' });
      paint(move.to, { outline: '2px dashed var(--color-accent)', outlineOffset: '-4px' });
    }

    if (!finished && inCheck(serverFen)) {
      const king = kingSquare(serverFen, turn);
      if (king) paint(king, { boxShadow: 'inset 0 0 0 4px var(--color-loss-fg)' });
    }

    if (selected) paint(selected, { boxShadow: 'inset 0 0 0 4px var(--color-accent)' });

    for (const target of targets) {
      paint(target.to, target.capture ? RING : DOT);
    }

    return styles;
  }, [finished, game.moves, queue, selected, serverFen, targets, turn]);

  /* ── Who is at the board ────────────────────────────────────── */
  const drawOffer = game.drawOffer ?? null;
  const myColour: 'white' | 'black' | null = viewerSide === 'w' ? 'white' : viewerSide === 'b' ? 'black' : null;
  const offeredByMe = myColour != null && drawOffer === myColour;
  const offeredToMe = myColour != null && drawOffer != null && !offeredByMe;
  const opponentName =
    viewerSide === 'w' ? game.black.name : viewerSide === 'b' ? game.white.name : 'your opponent';

  const status = finished
    ? 'Game over.'
    : !canMove
      ? 'Read-only — only the two seated players can move.'
      : myTurn
        ? queue.length > 0
          ? 'Playing your premove…'
          : selected
            ? 'Now pick a marked square.'
            : 'Your move.'
        : queue.length > 0
          ? `${queue.length} premove${queue.length === 1 ? '' : 's'} queued — waiting for ${opponentName}.`
          : `Waiting for ${opponentName}. You can plan a premove now.`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-3 sm:space-y-4">
        {/* Anyone who is not one of the two account holders at this board is a
            spectator: the position cannot be changed from here, and there is
            nothing else to do on this page. Say so rather than leaving them to
            work it out from a drag that does not take. */}
        {!canMove && !finished ? (
          <p className="border-2 border-info-fg bg-info-bg px-3 py-2 text-[12px] font-bold text-info-fg">
            Read-only. Only the two players seated at this board can move.
          </p>
        ) : null}

        <PlayerBar
          name={game.black.name}
          clock={clock}
          side="b"
          active={!finished && turn === 'b'}
          finished={finished}
          control={game.timeControl}
          offsetRef={offsetRef}
        />

        <div
          className="board-shell relative touch-manipulation overflow-hidden border-2 border-line select-none"
          /* The board is an interactive surface, not text: no callouts, no
             selection handles, no double-tap zoom. */
        >
          <Chessboard
            options={{
              id: 'arbiter-live-board',
              position: boardFen,
              boardOrientation: orientation,
              pieces,
              onPieceDrop,
              onSquareClick,
              allowDragging: canMove,
              canDragPiece: ({ piece }) =>
                viewerSide != null && piece.pieceType.charAt(0) === viewerSide,
              animationDurationInMs: 180,
              /* A finger always moves a few pixels while tapping. Without a
                 little slack every tap on a piece became a one-square drag —
                 and a drag that lands on the next square plays a move nobody
                 asked for. */
              dragActivationDistance: 10,
              showNotation: true,
              squareStyles,
              darkSquareStyle: { backgroundColor: 'var(--color-board-dark)' },
              lightSquareStyle: { backgroundColor: 'var(--color-board-light)' },
            }}
          />

          {pendingPromotion ? (
            <div className="absolute inset-0 z-20 flex items-end justify-center bg-canvas/90 p-3 backdrop-blur-sm sm:items-center">
              <div
                role="dialog"
                aria-label="Choose a piece to promote to"
                className="w-full max-w-sm border-2 border-ink bg-surface px-4 py-4 text-center shadow-brut"
              >
                <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
                  {pendingPromotion.premove ? 'Promotion — premove' : 'Promotion'}
                </p>
                <p className="mt-1 text-[15px] font-bold text-ink">Promote the pawn to</p>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {(['q', 'r', 'b', 'n'] as const).map((piece) => {
                    const Icon = defaultPieces[`${pendingPromotion.premove ? (viewerSide ?? 'w') : turn}${piece.toUpperCase()}`];
                    return (
                      <button
                        key={piece}
                        type="button"
                        onClick={() => choosePromotion(piece)}
                        aria-label={
                          { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[piece]
                        }
                        className="press flex min-h-14 flex-col items-center justify-center gap-1 border-2 border-ink bg-surface p-1.5 text-ink shadow-brut-sm hover:bg-bone"
                      >
                        <span className="block h-8 w-8" aria-hidden="true">
                          <Icon />
                        </span>
                        <span className="font-mono text-[10px] tracking-[0.1em] uppercase">
                          {piece}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setPendingPromotion(null)}
                  className="mt-3 w-full border-2 border-line-strong px-3 py-2 text-[12px] font-medium text-ink hover:bg-bone"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <PlayerBar
          name={game.white.name}
          clock={clock}
          side="w"
          active={!finished && turn === 'w'}
          finished={finished}
          control={game.timeControl}
          offsetRef={offsetRef}
        />

        {/* The status line is the board's caption: whose turn, and what a click
            will do next. */}
        <p className="flex min-h-6 items-center gap-2 text-[12px] leading-snug text-muted">
          {!finished ? (
            <span
              className={`inline-block h-2 w-2 flex-none border border-ink ${
                myTurn ? 'bg-accent' : queue.length > 0 ? 'bg-draw-fg' : 'bg-surface-sunken'
              }`}
              aria-hidden="true"
            />
          ) : null}
          <span aria-live="polite">{status}</span>
        </p>

        {/* ── The player's own controls ─────────────────────────── */}
        {canMove ? (
          <div className="flex flex-wrap gap-2">
            {offeredToMe ? (
              <>
                <button
                  type="button"
                  onClick={() => void settle('accept_draw')}
                  className="press min-h-11 flex-1 border-2 border-ink bg-accent px-4 py-2.5 text-[13px] font-bold text-on-accent shadow-brut-sm sm:flex-none"
                >
                  Accept {opponentName}&rsquo;s draw
                </button>
                <button
                  type="button"
                  onClick={() => void settle('decline_draw')}
                  className="press min-h-11 flex-1 border-2 border-line-strong px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-bone sm:flex-none"
                >
                  Play on
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={offeredByMe}
                onClick={() => void settle('offer_draw')}
                className="press min-h-11 flex-1 border-2 border-line-strong px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-bone disabled:opacity-50 sm:flex-none"
              >
                {offeredByMe ? 'Draw offered…' : 'Offer a draw'}
              </button>
            )}

            {confirmResign ? (
              <div className="flex min-h-11 flex-1 gap-2 sm:flex-none">
                <button
                  type="button"
                  onClick={() => void settle('resign')}
                  className="press flex-1 border-2 border-loss-fg bg-loss-bg px-4 py-2.5 text-[13px] font-bold text-loss-fg shadow-brut-sm"
                >
                  Yes, resign
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResign(false)}
                  className="press border-2 border-line-strong px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-bone"
                >
                  Keep playing
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmResign(true)}
                className="press min-h-11 flex-1 border-2 border-loss-fg px-4 py-2.5 text-[13px] font-bold text-loss-fg hover:bg-loss-bg sm:flex-none"
              >
                Resign
              </button>
            )}
          </div>
        ) : null}

        {/* ── The host's controls ────────────────────────────────
            The event has to be able to move on if both players walk away, so
            the host can settle a board administratively. It is visibly not
            the player's own row. */}
        {canSettle && !finished ? (
          <div className="flex flex-wrap items-center gap-2 border-2 border-line bg-surface-sunken px-3 py-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
              Host
            </span>
            <button
              type="button"
              onClick={() => void settle('draw')}
              className="press min-h-9 border-2 border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bone"
            >
              Declare a draw
            </button>
            <button
              type="button"
              onClick={() => void settle('resign', 'white')}
              className="press min-h-9 border-2 border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bone"
            >
              {game.white.name} resigns
            </button>
            <button
              type="button"
              onClick={() => void settle('resign', 'black')}
              className="press min-h-9 border-2 border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bone"
            >
              {game.black.name} resigns
            </button>
          </div>
        ) : null}

        {notice ? (
          <p className="border-2 border-line-strong bg-bone px-3 py-2 text-[12px] text-ink">
            {notice}
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="border-2 border-loss-bg bg-loss-bg px-3 py-2 text-[13px] text-loss-fg"
          >
            {error}
          </p>
        ) : null}

        {finished && game.moves.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDismissed(null)}
              className="press min-h-10 border-2 border-line-strong bg-surface px-3.5 py-2 text-[12px] font-medium text-ink hover:bg-bone"
            >
              Show the result again
            </button>
          </div>
        ) : null}
      </div>

      <aside className="min-w-0 space-y-4">
        {/* ── Planner ────────────────────────────────────────────
            A premove is a plan, so the plan is shown: what is queued, in the
            order it will be played, with a way out. */}
        {canMove ? (
          <section className="overflow-hidden border-2 border-line bg-surface shadow-brut">
            <header className="flex items-baseline justify-between gap-3 border-b-2 border-line px-4 py-2.5 sm:px-5">
              <h2 className="text-[13px] font-semibold text-ink">Planner</h2>
              <span className="font-mono text-[11px] text-muted">
                {queue.length}/{MAX_PREMOVES}
              </span>
            </header>

            <div className="px-4 py-3 sm:px-5">
              {queue.length === 0 ? (
                <p className="text-[12px] leading-relaxed text-muted">
                  {myTurn
                    ? 'Your move. Pick a piece, then a marked square.'
                    : `Tap a piece, then a marked square to premove. Up to ${MAX_PREMOVES} in order — they fire as each of ${opponentName}'s moves lands.`}
                </p>
              ) : (
                <ol className="flex flex-wrap gap-1.5 font-mono text-[12px]">
                  {queue.map((move, index) => (
                    <li
                      key={`${move.from}${move.to}${index}`}
                      className="flex items-center gap-1.5 border-2 border-line-strong bg-bone px-2 py-1 text-ink"
                    >
                      <span className="text-muted">{index + 1}.</span>
                      {move.from}
                      <span aria-hidden="true">→</span>
                      {move.to}
                      {move.promotion ? `=${move.promotion.toUpperCase()}` : ''}
                    </li>
                  ))}
                </ol>
              )}

              {queue.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setQueue([]);
                    setNotice(null);
                  }}
                  className="press mt-3 min-h-9 border-2 border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bone"
                >
                  Clear the queue
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden border-2 border-line bg-surface shadow-brut">
          <header className="border-b-2 border-line px-4 py-2.5 sm:px-5">
            <h2 className="text-[13px] font-semibold text-ink">Moves</h2>
            <p className="text-[12px] text-muted">
              {game.timeControl.mode === 'per_move'
                ? formatAllowance(game.timeControl.initialMs) + ' per move'
                : game.timeControl.label}
            </p>
          </header>
          <ol className="max-h-56 overflow-y-auto px-4 py-2.5 font-mono text-[13px] text-ink sm:px-5 lg:max-h-64">
            {game.moves.length === 0 ? (
              <li className="text-muted">No moves yet.</li>
            ) : (
              game.moves.map((move, index) => (
                <li key={index} className="flex gap-3 py-0.5">
                  <span className="w-8 text-muted">
                    {index % 2 === 0 ? `${index / 2 + 1}.` : ''}
                  </span>
                  <span>{move.san}</span>
                </li>
              ))
            )}
          </ol>
        </section>

        <EnginePanel fen={serverFen} />

        {finished && game.moves.length > 0 ? (
          <GameReview initialFen={game.startFen} moves={game.moves} />
        ) : null}
      </aside>

      {resultOpen && outcome ? (
        <GameResult
          outcome={outcome}
          result={game.result ?? ''}
          whiteName={game.white.name}
          blackName={game.black.name}
          onClose={() => setDismissed(fingerprint)}
        />
      ) : null}
    </div>
  );
}

function PlayerBar({
  name,
  clock,
  side,
  active,
  finished,
  control,
  offsetRef,
}: {
  name: string;
  clock: GameState['clock'];
  side: Side;
  active: boolean;
  finished: boolean;
  control: TimeControl;
  offsetRef: { current: number };
}) {
  /* The clock is the only thing on this page that changes ten times a second,
     so it is the only thing that ticks ten times a second. Keeping the interval
     in this leaf means the board, the move list and the engine panel are not
     rebuilt to move two digits — the whole page used to re-render at 10 Hz for
     a value that changes once a second. */
  const [, tick] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [active]);

  const bank = side === 'w' ? clock.whiteMs : clock.blackMs;
  const running = active && !finished;
  const ms = running
    ? Math.max(0, bank - (Date.now() + offsetRef.current - clock.turnStartedAt))
    : bank;

  return (
    <div
      className={`flex items-center justify-between gap-3 border-2 border-line px-3 py-2 sm:px-4 sm:py-2.5 ${
        active ? 'bg-surface shadow-brut-sm' : 'bg-surface-sunken'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-ink sm:text-[14px]">
        <span className="truncate">{name}</span>
        {active ? <span className="badge bg-info-bg text-info-fg">to move</span> : null}
      </span>

      {control.mode === 'none' ? (
        <span className="flex-none text-[11px] font-medium tracking-[0.06em] text-muted uppercase sm:text-[12px]">
          No clock
        </span>
      ) : control.mode === 'per_move' ? (
        /* Correspondence is a deadline, not a ticking clock: the value changes
           at most once a move, so it stays as type instead of becoming ten
           boards of split-flap. */
        <span
          className={`flex-none font-mono text-[15px] tabular-nums sm:text-[17px] ${
            active ? 'text-ink' : 'text-muted'
          }`}
        >
          {formatAllowance(ms)}
        </span>
      ) : (
        <GameClock ms={ms} idle={!active} />
      )}
    </div>
  );
}

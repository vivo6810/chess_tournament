import { notFound } from 'next/navigation';

import GameBoard, { type GameState } from '@/components/game-board';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { START_FEN, getGameWithPlayers, getTournamentById, movesOf } from '@/lib/service';
import { getTimeControl } from '@/lib/time-controls';

export const dynamic = 'force-dynamic';

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId) || gameId <= 0) notFound();

  /* One read for the game and the two names at the board — the same row the
     poll endpoint returns, assembled the same way. */
  const game = getGameWithPlayers(gameId);
  if (!game) notFound();

  const white = { name: game.white_name, user_id: game.white_user_id };
  const black = { name: game.black_name, user_id: game.black_user_id };

  const user = await getCurrentUser();
  const tournament = game.tournament_id ? getTournamentById(game.tournament_id) : null;
  /* The built-in admin settles any board, host or not. */
  const isHost = isAdmin(user) || (user != null && tournament?.host_id === user.id);
  /* Hosting is not playing. A host who is not one of the two account holders at
     this board gets the host controls and nothing else — the position can only
     be changed by the two people it belongs to. */
  const isSeated =
    user != null && (white?.user_id === user.id || black?.user_id === user.id);

  const initial: GameState = {
    game: {
      id: game.id,
      fen: game.fen,
      status: game.status,
      result: game.result,
      termination: game.termination,
      timeControl: getTimeControl(game.time_control),
      startFen: START_FEN,
      drawOffer:
        game.draw_offer_by == null
          ? null
          : game.draw_offer_by === white?.user_id
            ? 'white'
            : 'black',
      moves: movesOf(game).map((move) => ({ san: move.san, uci: move.uci, fen: move.fen })),
      white: { playerId: game.white_player_id, name: white?.name ?? 'White' },
      black: { playerId: game.black_player_id, name: black?.name ?? 'Black' },
    },
    clock: {
      whiteMs: game.white_ms,
      blackMs: game.black_ms,
      incrementMs: game.increment_ms,
      perMoveMs: game.per_move_ms,
      turnStartedAt: game.turn_started_at,
      serverNow: Date.now(),
    },
    seats: { seated: isSeated, isWhite: white?.user_id === user?.id },
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-5 sm:mb-8">
        <p className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
          {tournament ? tournament.name : 'Game'}
          {game.round_no ? ` · round ${game.round_no}, board ${game.board}` : ''}
        </p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-ink sm:text-[26px]">
          {white?.name ?? 'White'} <span className="text-muted">vs</span> {black?.name ?? 'Black'}
        </h1>
      </header>

      <GameBoard initial={initial} canSettle={Boolean(isHost)} />
    </div>
  );
}

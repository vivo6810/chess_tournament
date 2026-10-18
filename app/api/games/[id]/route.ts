import { NextResponse } from 'next/server';

import { handleError, jsonError, parseId, requireUser } from '@/lib/api';
import { getGameWithPlayers, movesOf } from '@/lib/service';
import { getTimeControl } from '@/lib/time-controls';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const gameId = parseId(id);
    if (!gameId) return jsonError('Bad game id.');

    const game = getGameWithPlayers(gameId);
    if (!game) return jsonError('Game not found.', 404);

    const auth = await requireUser();
    const viewerId = 'user' in auth ? auth.user.id : null;
    const white = { name: game.white_name || 'White', user_id: game.white_user_id };
    const black = { name: game.black_name || 'Black', user_id: game.black_user_id };
    /* Seated means one of the two account holders at this board. A non-seated
       viewer of any kind — host included — gets a read-only response. */
    const seated =
      viewerId != null && (white?.user_id === viewerId || black?.user_id === viewerId);

    return NextResponse.json({
      game: {
        id: game.id,
        fen: game.fen,
        status: game.status,
        result: game.result,
        termination: game.termination,
        timeControl: getTimeControl(game.time_control),
        moves: movesOf(game),
        drawOffer:
          game.draw_offer_by == null
            ? null
            : game.draw_offer_by === white.user_id
              ? 'white'
              : 'black',
        white: { playerId: game.white_player_id, name: white.name },
        black: { playerId: game.black_player_id, name: black.name },
      },
      clock: {
        whiteMs: game.white_ms,
        blackMs: game.black_ms,
        incrementMs: game.increment_ms,
        perMoveMs: game.per_move_ms,
        turnStartedAt: game.turn_started_at,
        /**
         * The client needs the server's clock to know how long the current turn
         * has actually run. It renders its own tick from this, but the value it
         * submits on a move is never trusted.
         */
        serverNow: Date.now(),
      },
      seats: { seated, isWhite: white.user_id === viewerId },
    });
  } catch (error) {
    return handleError(error);
  }
}

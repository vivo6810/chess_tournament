import { Chess } from 'chess.js';
import { NextResponse } from 'next/server';

import { handleError, jsonError, parseId, readJson, requireUser } from '@/lib/api';
import { db } from '@/lib/db';
import { applyMove } from '@/lib/game';
import { finishGame, getGame, movesOf } from '@/lib/service';
import { getTimeControl } from '@/lib/time-controls';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await requireUser();
    if ('response' in auth) return auth.response;

    const { id } = await params;
    const gameId = parseId(id);
    if (!gameId) return jsonError('Bad game id.');

    const game = getGame(gameId);
    if (!game) return jsonError('Game not found.', 404);
    if (game.status !== 'active') return jsonError('This game has already finished.');

    /* The side to move is read from the position, never from the request. A
       client cannot move for its opponent by claiming the other colour. */
    const sideToMove = new Chess(game.fen).turn();
    const moverPlayerId = sideToMove === 'w' ? game.white_player_id : game.black_player_id;

    const seat = db
      .prepare('SELECT user_id FROM tournament_players WHERE id = ?')
      .get(moverPlayerId) as { user_id: number | null } | undefined;

    /* Only the two account holders at this board may move. The host runs the
       event — start, draw, settle — but does not get to play someone else's
       moves for them. */
    if (seat?.user_id !== auth.user.id) {
      return jsonError('You are not seated in this game.', 403);
    }

    const body = await readJson<{ from: string; to: string; promotion?: string }>(request);
    const from = typeof body.from === 'string' ? body.from : '';
    const to = typeof body.to === 'string' ? body.to : '';
    if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) {
      return jsonError('Send squares like "e2" and "e4".');
    }

    const control = getTimeControl(game.time_control);
    const outcome = applyMove(
      game.fen,
      { from, to, promotion: body.promotion },
      {
        white_ms: game.white_ms,
        black_ms: game.black_ms,
        increment_ms: game.increment_ms,
        per_move_ms: game.per_move_ms,
        turn_started_at: game.turn_started_at,
      },
      control,
      Date.now(),
    );

    if (!outcome.ok) {
      if (outcome.reason === 'flag' && outcome.clock?.flagged) {
        /* The move arrived after the flag fell. The server decides this, not
           the client's own clock, so a slow or tampered client loses on time
           the same as an honest one. */
        const winner = outcome.clock.flagged === 'white' ? '0-1' : '1-0';
        finishGame(gameId, winner, 'timeout');
        return NextResponse.json({
          flagged: outcome.clock.flagged,
          result: winner,
          termination: 'timeout',
        });
      }
      return jsonError('That move is not legal in this position.');
    }

    const at = Date.now();
    const moves = [
      ...movesOf(game),
      {
        san: outcome.san,
        uci: outcome.uci,
        fen: outcome.fen,
        at,
        whiteMs: outcome.clock.whiteMs,
        blackMs: outcome.clock.blackMs,
      },
    ];

    /* A move is an answer: any standing draw offer lapses the moment the
       opponent plays on. */
    db.prepare('UPDATE games SET draw_offer_by = NULL WHERE id = ?').run(gameId);

    db.prepare(
      `UPDATE games SET fen = ?, moves = ?, white_ms = ?, black_ms = ?,
         turn_started_at = ?, updated_at = ? WHERE id = ?`,
    ).run(
      outcome.fen,
      JSON.stringify(moves),
      outcome.clock.whiteMs,
      outcome.clock.blackMs,
      at,
      at,
      gameId,
    );

    if (outcome.over) {
      finishGame(gameId, outcome.over.result, outcome.over.termination);
    }

    return NextResponse.json({
      san: outcome.san,
      fen: outcome.fen,
      over: outcome.over,
      clock: { whiteMs: outcome.clock.whiteMs, blackMs: outcome.clock.blackMs, turnStartedAt: at },
    });
  } catch (error) {
    return handleError(error);
  }
}

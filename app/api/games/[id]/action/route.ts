import { NextResponse } from 'next/server';

import { handleError, jsonError, parseId, readJson, requireUser } from '@/lib/api';
import { canSettleGames } from '@/lib/auth';
import { db } from '@/lib/db';
import { finishGame, getGame, getTournamentById } from '@/lib/service';

type Params = { params: Promise<{ id: string }> };

/**
 * Resignation and agreed draws are tournament outcomes, not board positions — no
 * amount of engine analysis can derive them, which is why they need an explicit
 * endpoint rather than being inferred in the move handler.
 *
 * Two audiences, with different rights:
 *
 *   - a player at the board may resign, offer a draw, accept or decline the
 *     opponent's offer. A draw is an agreement, so one player offering is not
 *     a draw — the offer is held on the game row until the other answers.
 *   - the host may settle the game administratively (the event has to be able
 *     to move on if both players walk away), and abort a game before it counts.
 */
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

    const seats = db
      .prepare('SELECT id, user_id FROM tournament_players WHERE id IN (?, ?)')
      .all(game.white_player_id, game.black_player_id) as { id: number; user_id: number | null }[];

    const whiteUserId = seats.find((row) => row.id === game.white_player_id)?.user_id ?? null;
    const blackUserId = seats.find((row) => row.id === game.black_player_id)?.user_id ?? null;

    const viewerId = auth.user.id;
    const viewerSide: 'white' | 'black' | null =
      whiteUserId === viewerId ? 'white' : blackUserId === viewerId ? 'black' : null;

    const tournament = game.tournament_id ? getTournamentById(game.tournament_id) : null;
    /* A suspended event is frozen: resigning someone's board would be exactly
       the interference suspension is meant to stop. */
    if (tournament?.suspended === 1) {
      return jsonError('This tournament is suspended by the owner.', 403);
    }

    /* The admin settles any board: the account exists so a stuck game can be
       finished from anywhere, including one nobody at the board can reach. The
       owner is deliberately excluded — see `canSettleGames`. */
    const isHost = canSettleGames(auth.user) || tournament?.host_id === viewerId;

    const body = await readJson<{ action: string; side: 'white' | 'black' }>(request);
    const action = typeof body.action === 'string' ? body.action : '';

    /* ── A player's own outcomes ─────────────────────────────────── */

    if (action === 'resign') {
      /* A player resigns their own seat. The host can resign a given side,
         which is how an abandoned game gets settled without waiting for a
         flag that may never fall in a correspondence game. */
      const side =
        viewerSide ?? (isHost ? (body.side === 'black' ? 'black' : 'white') : null);
      if (!side) return jsonError('You are not seated in this game.', 403);

      const result = side === 'white' ? '0-1' : '1-0';
      finishGame(gameId, result, 'resignation');
      return NextResponse.json({ result, termination: 'resignation', side });
    }

    if (action === 'offer_draw') {
      if (!viewerSide) return jsonError('You are not seated in this game.', 403);
      db.prepare('UPDATE games SET draw_offer_by = ?, updated_at = ? WHERE id = ?').run(
        viewerId,
        Date.now(),
        gameId,
      );
      return NextResponse.json({ drawOffer: viewerSide });
    }

    if (action === 'accept_draw' || action === 'decline_draw') {
      if (!viewerSide) return jsonError('You are not seated in this game.', 403);
      if (game.draw_offer_by == null) return jsonError('There is no draw offer to answer.');

      /* Only the player who did not make the offer can answer it. Accepting
         your own offer would be a one-click draw. */
      const offerSide =
        game.draw_offer_by === whiteUserId ? 'white' : game.draw_offer_by === blackUserId ? 'black' : null;

      if (offerSide === viewerSide) return jsonError('You cannot answer your own draw offer.');

      if (action === 'accept_draw') {
        finishGame(gameId, '1/2-1/2', 'agreement');
        return NextResponse.json({ result: '1/2-1/2', termination: 'agreement' });
      }

      db.prepare('UPDATE games SET draw_offer_by = NULL, updated_at = ? WHERE id = ?').run(
        Date.now(),
        gameId,
      );
      return NextResponse.json({ drawOffer: null });
    }

    /* ── The host's administrative outcomes ──────────────────────── */

    if (action === 'draw' || action === 'abort') {
      if (!isHost) return jsonError('Only the host can settle this game.', 403);
    }

    if (action === 'draw') {
      finishGame(gameId, '1/2-1/2', 'agreement');
      return NextResponse.json({ result: '1/2-1/2', termination: 'agreement' });
    }

    if (action === 'abort') {
      // Aborting returns the board to the start without scoring it.
      db.prepare(
        `UPDATE games SET status = 'active', result = NULL, termination = NULL,
           moves = '[]', fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
           draw_offer_by = NULL, updated_at = ? WHERE id = ?`,
      ).run(Date.now(), gameId);
      return NextResponse.json({ aborted: true });
    }

    return jsonError('Unknown action.');
  } catch (error) {
    return handleError(error);
  }
}

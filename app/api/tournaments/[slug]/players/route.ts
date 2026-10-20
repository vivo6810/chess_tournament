import { NextResponse } from 'next/server';

import { handleError, jsonError, parseId, readJson, requireUser } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { addPlayers, getTournamentBySlug, listPlayers, removePlayer } from '@/lib/service';

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const tournament = getTournamentBySlug(slug);
    if (!tournament) return jsonError('Tournament not found.', 404);
    return NextResponse.json({ players: listPlayers(tournament.id) });
  } catch (error) {
    return handleError(error);
  }
}

/** Accepts a newline-separated blob so a host can paste a sign-up sheet. */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await requireUser();
    if ('response' in auth) return auth.response;

    const { slug } = await params;
    const tournament = getTournamentBySlug(slug);
    if (!tournament) return jsonError('Tournament not found.', 404);
    // Only the host owns the entry list.
    if (!isAdmin(auth.user) && tournament.host_id !== auth.user.id) {
      return jsonError('Only the host can edit players.', 403);
    }

    const body = await readJson<{ names: string | string[] }>(request);
    const names = Array.isArray(body.names)
      ? body.names
      : String(body.names ?? '').split(/[\n,]/);

    const added = addPlayers(tournament.id, names);
    return NextResponse.json({ added, players: listPlayers(tournament.id) });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await requireUser();
    if ('response' in auth) return auth.response;

    const { slug } = await params;
    const tournament = getTournamentBySlug(slug);
    if (!tournament) return jsonError('Tournament not found.', 404);
    if (!isAdmin(auth.user) && tournament.host_id !== auth.user.id) {
      return jsonError('Only the host can edit players.', 403);
    }

    const playerId = parseId(new URL(request.url).searchParams.get('playerId') ?? undefined);
    if (!playerId) return jsonError('Missing playerId.');

    removePlayer(tournament.id, playerId);
    return NextResponse.json({ players: listPlayers(tournament.id) });
  } catch (error) {
    return handleError(error);
  }
}

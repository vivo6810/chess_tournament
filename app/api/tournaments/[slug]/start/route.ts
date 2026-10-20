import { NextResponse } from 'next/server';

import { handleError, jsonError, requireUser } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { getTournamentBySlug, roundView, startTournament, standingsFor } from '@/lib/service';

type Params = { params: Promise<{ slug: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const auth = await requireUser();
    if ('response' in auth) return auth.response;

    const { slug } = await params;
    const tournament = getTournamentBySlug(slug);
    if (!tournament) return jsonError('Tournament not found.', 404);
    if (!isAdmin(auth.user) && tournament.host_id !== auth.user.id) {
      return jsonError('Only the host can start this tournament.', 403);
    }

    const started = startTournament(tournament.id);
    return NextResponse.json({
      tournament: started,
      pairings: roundView(started.id, started.current_round),
      standings: standingsFor(started.id),
    });
  } catch (error) {
    return handleError(error);
  }
}

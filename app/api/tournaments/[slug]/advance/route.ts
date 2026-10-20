import { NextResponse } from 'next/server';

import { handleError, jsonError, requireUser } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { advanceRound, getTournamentBySlug, roundView, standingsFor } from '@/lib/service';

type Params = { params: Promise<{ slug: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const auth = await requireUser();
    if ('response' in auth) return auth.response;

    const { slug } = await params;
    const tournament = getTournamentBySlug(slug);
    if (!tournament) return jsonError('Tournament not found.', 404);
    if (!isAdmin(auth.user) && tournament.host_id !== auth.user.id) {
      return jsonError('Only the host can draw the next round.', 403);
    }

    const advanced = advanceRound(tournament.id);
    return NextResponse.json({
      tournament: advanced,
      pairings: advanced.status === 'running' ? roundView(advanced.id, advanced.current_round) : [],
      standings: standingsFor(advanced.id),
    });
  } catch (error) {
    return handleError(error);
  }
}

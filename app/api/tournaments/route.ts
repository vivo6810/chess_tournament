import { NextResponse } from 'next/server';

import { handleError, jsonError, readJson, requireUser } from '@/lib/api';
import { roundCountForSwiss } from '@/lib/pairing';
import { createTournament, listTournaments } from '@/lib/service';
import { isTimeControlId } from '@/lib/time-controls';

export async function GET() {
  try {
    return NextResponse.json({ tournaments: listTournaments() });
  } catch (error) {
    return handleError(error);
  }
}

type CreateBody = {
  name: string;
  format: 'swiss' | 'round_robin';
  timeControl: string;
  players: string[];
};

export async function POST(request: Request) {
  try {
    const auth = await requireUser();
    if ('response' in auth) return auth.response;

    const body = await readJson<CreateBody>(request);
    const name = typeof body.name === 'string' ? body.name : '';
    const format = body.format === 'round_robin' ? 'round_robin' : 'swiss';
    const timeControl = typeof body.timeControl === 'string' ? body.timeControl : '';
    const players = Array.isArray(body.players) ? body.players.filter((p) => typeof p === 'string') : [];

    if (!isTimeControlId(timeControl)) return jsonError('Choose a valid time control.');
    if (players.length < 2) return jsonError('Add at least two players.');

    const created = createTournament({
      hostId: auth.user.id,
      name,
      format,
      timeControlId: timeControl,
      playerNames: players,
      totalRounds: 0,
    });

    return NextResponse.json(
      {
        tournament: created,
        suggestedRounds: roundCountForSwiss(players.filter((p) => p.trim()).length),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleError(error);
  }
}

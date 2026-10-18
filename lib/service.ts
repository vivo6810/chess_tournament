import {
  computeStandings,
  generateRoundRobin,
  generateSwissRound,
  roundCountForSwiss,
  type GeneratedPairing,
  type ResultInput,
  type Standing,
  type StandingInput,
} from './pairing';
import { normalizeUsername } from './auth';
import { db, now, parseMoves, slugify, type GameRow, type PairingRow, type PlayerRow, type TournamentRow } from './db';
import { getTimeControl } from './time-controls';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

/* node:sqlite does not ship an interactive transaction helper, and the
   tournament writes below span several statements. */
function transaction<T>(work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/* ── Reads ─────────────────────────────────────────────────────────────── */

export function getTournamentBySlug(slug: string): TournamentRow | null {
  return (db.prepare('SELECT * FROM tournaments WHERE slug = ?').get(slug) as TournamentRow) ?? null;
}

export function getTournamentById(id: number): TournamentRow | null {
  return (db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as TournamentRow) ?? null;
}

export function listTournaments(limit = 50): (TournamentRow & { player_count: number; host_name: string })[] {
  return db
    .prepare(
      `SELECT t.*, u.username AS host_name,
              (SELECT COUNT(*) FROM tournament_players p
                WHERE p.tournament_id = t.id AND p.withdrawn = 0) AS player_count
       FROM tournaments t
       JOIN users u ON u.id = t.host_id
       ORDER BY t.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as (TournamentRow & { player_count: number; host_name: string })[];
}

export function listPlayers(tournamentId: number): PlayerRow[] {
  return db
    .prepare('SELECT * FROM tournament_players WHERE tournament_id = ? ORDER BY seed ASC')
    .all(tournamentId) as PlayerRow[];
}

export function listPairings(tournamentId: number, round?: number): PairingRow[] {
  if (round === undefined) {
    return db
      .prepare('SELECT * FROM pairings WHERE tournament_id = ? ORDER BY round_no ASC, board ASC')
      .all(tournamentId) as PairingRow[];
  }
  return db
    .prepare('SELECT * FROM pairings WHERE tournament_id = ? AND round_no = ? ORDER BY board ASC')
    .all(tournamentId, round) as PairingRow[];
}

export function getGame(id: number): GameRow | null {
  return (db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow) ?? null;
}

/**
 * A game together with the two names at the board.
 *
 * One query rather than three: the game, then one lookup per player, is three
 * round trips for a response the game page re-fetches every second. The seats
 * are foreign keys, so the join cannot drop a row a plain lookup would have
 * found.
 */
export type GameWithPlayers = GameRow & {
  white_name: string;
  white_user_id: number | null;
  black_name: string;
  black_user_id: number | null;
};

export function getGameWithPlayers(id: number): GameWithPlayers | null {
  return (
    (db
      .prepare(
        `SELECT g.*,
                wp.name AS white_name, wp.user_id AS white_user_id,
                bp.name AS black_name, bp.user_id AS black_user_id
         FROM games g
         JOIN tournament_players wp ON wp.id = g.white_player_id
         JOIN tournament_players bp ON bp.id = g.black_player_id
         WHERE g.id = ?`,
      )
      .get(id) as GameWithPlayers) ?? null
  );
}

/**
 * The games for a set of ids, in one query.
 *
 * The round view needs a game per board; asking for them one at a time is a
 * query per board per page load for no reason, since a round is always viewed
 * whole.
 */
export function getGamesByIds(ids: number[]): Map<number, GameRow> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM games WHERE id IN (${placeholders})`)
    .all(...unique) as GameRow[];

  return new Map(rows.map((row) => [row.id, row]));
}

export function resultsFor(tournamentId: number): ResultInput[] {
  const rows = listPairings(tournamentId);
  return rows.map((row) => ({
    playerId: row.white_id ?? row.black_id!,
    round: row.round_no,
    board: row.board,
    whiteId: row.white_id,
    blackId: row.black_id,
    isBye: row.is_bye === 1,
    result: row.result,
  }));
}

export function standingsFor(tournamentId: number): Standing[] {
  const players = listPlayers(tournamentId);
  const inputs: StandingInput[] = players.map((player) => ({
    playerId: player.id,
    name: player.name,
    seed: player.seed,
    withdrawn: player.withdrawn === 1,
  }));
  return computeStandings(inputs, resultsFor(tournamentId));
}

export type PairingView = {
  pairing: PairingRow;
  whiteName: string | null;
  blackName: string | null;
  /** Live clock snapshot for the board view. */
  game: GameRow | null;
};

export function roundView(tournamentId: number, round: number): PairingView[] {
  const players = new Map(listPlayers(tournamentId).map((p) => [p.id, p.name]));
  const pairings = listPairings(tournamentId, round);
  const games = getGamesByIds(
    pairings.map((pairing) => pairing.game_id).filter((id): id is number => id != null),
  );

  return pairings.map((pairing) => ({
    pairing,
    whiteName: pairing.white_id ? players.get(pairing.white_id) ?? null : null,
    blackName: pairing.black_id ? players.get(pairing.black_id) ?? null : null,
    game: pairing.game_id ? games.get(pairing.game_id) ?? null : null,
  }));
}

/* ── Creation ──────────────────────────────────────────────────────────── */

export function createTournament(input: {
  hostId: number;
  name: string;
  format: 'swiss' | 'round_robin';
  timeControlId: string;
  playerNames: string[];
  totalRounds?: number;
}): TournamentRow {
  const name = input.name.trim();
  if (!name) throw new ServiceError('Give the tournament a name.');
  if (name.length > 80) throw new ServiceError('Tournament names are limited to 80 characters.');

  const names = dedupeNames(input.playerNames);
  if (names.length < 2) throw new ServiceError('A tournament needs at least two players.');

  const slug = slugify(name);
  const timestamp = now();

  return transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO tournaments
           (slug, name, host_id, format, time_control, total_rounds, status, current_round, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, ?)`,
      )
      .run(
        slug,
        name,
        input.hostId,
        input.format,
        input.timeControlId,
        input.totalRounds ?? 0,
        timestamp,
      );

    const tournamentId = Number(info.lastInsertRowid);
    insertPlayers(tournamentId, names, timestamp);

    return getTournamentById(tournamentId)!;
  });
}

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(name.slice(0, 60));
  }
  return output;
}

function insertPlayers(tournamentId: number, names: string[], timestamp: number) {
  const existing = db
    .prepare('SELECT COUNT(*) AS count FROM tournament_players WHERE tournament_id = ?')
    .get(tournamentId) as { count: number };
  let seed = existing.count;

  const statement = db.prepare(
    `INSERT INTO tournament_players (tournament_id, name, seed, user_id, withdrawn, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  );
  const findUser = db.prepare('SELECT id FROM users WHERE username_key = ?');

  for (const name of names) {
    seed += 1;
    /* A name that matches a registered username *is* that account's seat.
       Without this link nobody could ever move: the move handler accepts only
       the two account holders at a board, so an unlinked field would be a
       tournament of spectators — and a host who is not seated could not play
       either. */
    const user = findUser.get(normalizeUsername(name)) as { id: number } | undefined;
    statement.run(tournamentId, name, seed, user?.id ?? null, timestamp);
  }
}

export function addPlayers(tournamentId: number, names: string[]): number {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) throw new ServiceError('Tournament not found.');
  if (tournament.status !== 'draft') {
    throw new ServiceError('Players can only be added before the tournament starts.');
  }

  const cleaned = dedupeNames(names);
  if (!cleaned.length) return 0;

  return transaction(() => {
    const before = listPlayers(tournamentId);
    const existing = new Set(before.map((p) => p.name.toLowerCase()));
    const fresh = cleaned.filter((name) => !existing.has(name.toLowerCase()));
    if (fresh.length) insertPlayers(tournamentId, fresh, now());
    return fresh.length;
  });
}

export function removePlayer(tournamentId: number, playerId: number): void {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) throw new ServiceError('Tournament not found.');

  if (tournament.status === 'draft') {
    db.prepare('DELETE FROM tournament_players WHERE id = ? AND tournament_id = ?').run(
      playerId,
      tournamentId,
    );
    return;
  }

  /* Mid-event, deleting a player would erase their results and silently change
     everyone else's tiebreaks. Withdrawing keeps the history intact. */
  db.prepare(
    'UPDATE tournament_players SET withdrawn = 1 WHERE id = ? AND tournament_id = ?',
  ).run(playerId, tournamentId);
}

/* ── Round generation ──────────────────────────────────────────────────── */

/**
 * Creates one game per board, including the byes (which are recorded on the
 * pairing and resolve to an automatic win without a game row).
 */
function materialiseRound(tournament: TournamentRow, round: number, pairings: GeneratedPairing[]) {
  const control = getTimeControl(tournament.time_control);
  const timestamp = now();

  const insertPairing = db.prepare(
    `INSERT INTO pairings (tournament_id, round_no, board, white_id, black_id, result, is_bye)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertGame = db.prepare(
    `INSERT INTO games
       (tournament_id, round_no, board, white_player_id, black_player_id, time_control, fen,
        moves, status, white_ms, black_ms, increment_ms, per_move_ms, turn_started_at,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'active', ?, ?, ?, ?, ?, ?, ?)`,
  );
  const linkGame = db.prepare('UPDATE pairings SET game_id = ? WHERE id = ?');

  for (const pairing of pairings) {
    const result = pairing.isBye ? '1-0' : null;
    const info = insertPairing.run(
      tournament.id,
      round,
      pairing.board,
      pairing.whiteId,
      pairing.blackId,
      result,
      pairing.isBye ? 1 : 0,
    );
    const pairingId = Number(info.lastInsertRowid);

    if (pairing.isBye || pairing.whiteId == null || pairing.blackId == null) continue;

    const bank = control.initialMs;
    const gameInfo = insertGame.run(
      tournament.id,
      round,
      pairing.board,
      pairing.whiteId,
      pairing.blackId,
      tournament.time_control,
      START_FEN,
      bank,
      bank,
      control.incrementMs,
      control.mode === 'per_move' ? control.initialMs : 0,
      timestamp,
      timestamp,
      timestamp,
    );
    linkGame.run(Number(gameInfo.lastInsertRowid), pairingId);
  }
}

export function startTournament(tournamentId: number): TournamentRow {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) throw new ServiceError('Tournament not found.');
  if (tournament.status !== 'draft') throw new ServiceError('This tournament has already started.');

  const players = listPlayers(tournamentId).filter((p) => p.withdrawn === 0);
  if (players.length < 2) throw new ServiceError('Add at least two players before starting.');

  return transaction(() => {
    if (tournament.format === 'round_robin') {
      const standings = standingsFor(tournamentId);
      const rounds = generateRoundRobin(standings);
      rounds.forEach((pairings, index) => materialiseRound(tournament, index + 1, pairings));
      db.prepare(
        `UPDATE tournaments SET status = 'running', current_round = 1,
           total_rounds = ?, started_at = ? WHERE id = ?`,
      ).run(rounds.length, now(), tournamentId);
    } else {
      const total = tournament.total_rounds || roundCountForSwiss(players.length);
      const standings = standingsFor(tournamentId);
      const pairings = generateSwissRound(standings, 1);
      materialiseRound(tournament, 1, pairings);
      db.prepare(
        `UPDATE tournaments SET status = 'running', current_round = 1,
           total_rounds = ?, started_at = ? WHERE id = ?`,
      ).run(total, now(), tournamentId);
    }
    return getTournamentById(tournamentId)!;
  });
}

/**
 * Advances to the next round. Refuses while any board is still running, so the
 * draw is always computed against a complete set of results.
 */
export function advanceRound(tournamentId: number): TournamentRow {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) throw new ServiceError('Tournament not found.');
  if (tournament.status !== 'running') throw new ServiceError('This tournament is not running.');

  const pending = unfinishedGames(tournamentId);
  if (pending > 0) {
    throw new ServiceError(
      `${pending} game${pending === 1 ? '' : 's'} still running. Finish them before drawing the next round.`,
    );
  }

  return transaction(() => {
    if (tournament.format === 'round_robin') {
      const next = tournament.current_round + 1;
      if (next > tournament.total_rounds) {
        db.prepare(`UPDATE tournaments SET status = 'finished' WHERE id = ?`).run(tournamentId);
      } else {
        db.prepare('UPDATE tournaments SET current_round = ? WHERE id = ?').run(next, tournamentId);
      }
      return getTournamentById(tournamentId)!;
    }

    const next = tournament.current_round + 1;
    if (next > tournament.total_rounds) {
      db.prepare(`UPDATE tournaments SET status = 'finished' WHERE id = ?`).run(tournamentId);
      return getTournamentById(tournamentId)!;
    }

    const standings = standingsFor(tournamentId);
    const pairings = generateSwissRound(standings, next);
    materialiseRound(tournament, next, pairings);
    db.prepare('UPDATE tournaments SET current_round = ? WHERE id = ?').run(next, tournamentId);
    return getTournamentById(tournamentId)!;
  });
}

export function unfinishedGames(tournamentId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM games WHERE tournament_id = ? AND status = 'active'")
    .get(tournamentId) as { count: number };
  return row.count;
}

/* ── Results ───────────────────────────────────────────────────────────── */

export function finishGame(
  gameId: number,
  result: '1-0' | '0-1' | '1/2-1/2',
  termination: string,
  movesJson?: string,
): void {
  transaction(() => {
    const game = getGame(gameId);
    if (!game) throw new ServiceError('Game not found.');

    db.prepare(
      `UPDATE games SET status = 'finished', result = ?, termination = ?, updated_at = ?
       ${movesJson ? ', moves = ?' : ''}
       WHERE id = ?`,
    ).run(
      ...(movesJson
        ? [result, termination, now(), movesJson, gameId]
        : [result, termination, now(), gameId]),
    );

    if (game.tournament_id != null) {
      db.prepare(
        'UPDATE pairings SET result = ? WHERE game_id = ?',
      ).run(result, gameId);
    }
  });
}

export function movesOf(game: GameRow) {
  return parseMoves(game.moves);
}

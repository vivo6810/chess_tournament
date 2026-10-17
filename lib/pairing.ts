/**
 * Tournament pairing.
 *
 * Everything here is pure: it takes the players and the games already played and
 * returns the next set of pairings. No database access, so the whole thing is
 * testable and the same code drives both round generation and the live
 * standings table.
 */

export type Color = 'w' | 'b';

export type StandingInput = {
  playerId: number;
  name: string;
  seed: number;
  withdrawn: boolean;
};

export type ResultInput = {
  playerId: number;
  round: number;
  board: number;
  whiteId: number | null;
  blackId: number | null;
  isBye: boolean;
  /** '1-0' | '0-1' | '1/2-1/2' | null while the game is still running. */
  result: string | null;
};

export type Standing = {
  playerId: number;
  name: string;
  seed: number;
  score: number;
  played: number;
  wins: number;
  colors: Color[];
  /** Opponent ids in round order, parallel to `rounds`. */
  opponents: number[];
  rounds: number[];
  hadBye: boolean;
  buchholz: number;
  sonnebornBerger: number;
  rank: number;
};

export type GeneratedPairing = {
  board: number;
  whiteId: number | null;
  blackId: number | null;
  isBye: boolean;
};

const POINTS_WIN = 1;
const POINTS_DRAW = 0.5;

/* ── Scoring ───────────────────────────────────────────────────────────── */

export function pointsFor(result: string | null, side: 'white' | 'black'): number {
  if (result === '1-0') return side === 'white' ? POINTS_WIN : 0;
  if (result === '0-1') return side === 'black' ? POINTS_WIN : 0;
  if (result === '1/2-1/2') return POINTS_DRAW;
  return 0;
}

/**
 * Builds the full crosstable. Tiebreaks are computed from final scores, so this
 * must run after every result is in — Buchholz is the sum of your opponents'
 * scores, which is exactly why it cannot be updated incrementally.
 */
export function computeStandings(players: StandingInput[], results: ResultInput[]): Standing[] {
  const table = new Map<number, Standing>();

  for (const player of players) {
    table.set(player.playerId, {
      playerId: player.playerId,
      name: player.name,
      seed: player.seed,
      score: 0,
      played: 0,
      wins: 0,
      colors: [],
      opponents: [],
      rounds: [],
      hadBye: false,
      buchholz: 0,
      sonnebornBerger: 0,
      rank: 0,
    });
  }

  const ordered = [...results].sort((a, b) => a.round - b.round || a.board - b.board);

  for (const entry of ordered) {
    if (entry.isBye) {
      const player = entry.whiteId != null ? table.get(entry.whiteId) : undefined;
      if (!player) continue;
      player.score += POINTS_WIN;
      player.played += 1;
      player.wins += 1;
      player.hadBye = true;
      player.rounds.push(entry.round);
      player.opponents.push(-1);
      continue;
    }

    if (entry.whiteId == null || entry.blackId == null) continue;
    const white = table.get(entry.whiteId);
    const black = table.get(entry.blackId);
    if (!white || !black) continue;

    const whitePoints = pointsFor(entry.result, 'white');
    const blackPoints = pointsFor(entry.result, 'black');

    white.score += whitePoints;
    black.score += blackPoints;
    white.played += 1;
    black.played += 1;
    if (whitePoints === POINTS_WIN) white.wins += 1;
    if (blackPoints === POINTS_WIN) black.wins += 1;

    white.colors.push('w');
    black.colors.push('b');
    white.opponents.push(black.playerId);
    black.opponents.push(white.playerId);
    white.rounds.push(entry.round);
    black.rounds.push(entry.round);
  }

  const all = [...table.values()];

  for (const player of all) {
    player.buchholz = player.opponents.reduce((sum, opponentId) => {
      const opponent = opponentId > 0 ? table.get(opponentId) : undefined;
      return sum + (opponent ? opponent.score : 0);
    }, 0);

    /* Sonneborn-Berger weights each opponent by the points you actually
       took off them, so beating a strong opponent counts for more than
       beating a weak one twice. */
    player.sonnebornBerger = player.opponents.reduce((sum, opponentId, index) => {
      if (opponentId <= 0) return sum;
      const opponent = table.get(opponentId);
      if (!opponent) return sum;
      const round = player.rounds[index];
      const entry = ordered.find(
        (e) =>
          e.round === round &&
          !e.isBye &&
          (e.whiteId === player.playerId || e.blackId === player.playerId) &&
          (e.whiteId === opponentId || e.blackId === opponentId),
      );
      if (!entry) return sum;
      const side = entry.whiteId === player.playerId ? 'white' : 'black';
      return sum + pointsFor(entry.result, side) * opponent.score;
    }, 0);
  }

  all.sort(
    (a, b) =>
      b.score - a.score ||
      b.buchholz - a.buchholz ||
      b.sonnebornBerger - a.sonnebornBerger ||
      b.wins - a.wins ||
      a.seed - b.seed,
  );
  all.forEach((player, index) => {
    player.rank = index + 1;
  });

  return all;
}

/* ── Colour allocation ─────────────────────────────────────────────────── */

const countColor = (colors: Color[], color: Color) => colors.filter((c) => c === color).length;

function trailingStreak(colors: Color[]): number {
  if (!colors.length) return 0;
  const last = colors[colors.length - 1];
  let streak = 0;
  for (let i = colors.length - 1; i >= 0 && colors[i] === last; i -= 1) streak += 1;
  return streak;
}

/**
 * How much a player wants white, as one comparable number.
 *
 * The first term is absolute balance: being one black behind is a real claim on
 * white, being two behind is a stronger one. The second term breaks ties by the
 * most recent colour, which is what produces alternation between rounds instead
 * of two players oscillating in lockstep.
 *
 * Collapsing colour allocation into a single scalar matters: comparing two
 * separate preference flags leaves the "both players want the same colour" case
 * to an arbitrary fallback, and that fallback hands the same player black round
 * after round.
 */
export function desireForWhite(colors: Color[]): number {
  const whites = countColor(colors, 'w');
  const blacks = countColor(colors, 'b');
  const last = colors[colors.length - 1];
  const recent = last === 'b' ? 1 : last === 'w' ? -1 : 0;
  return 2 * (blacks - whites) + recent;
}

/** The colour a player is owed, or null when nothing is owed either way. */
export function preferredColor(colors: Color[]): Color | null {
  const whites = countColor(colors, 'w');
  const blacks = countColor(colors, 'b');
  if (whites < blacks) return 'w';
  if (blacks < whites) return 'b';
  if (!colors.length) return null;
  return colors[colors.length - 1] === 'w' ? 'b' : 'w';
}

function assignColor(
  first: Standing,
  second: Standing,
  colors: Map<number, Color[]>,
): { white: Standing; black: Standing } {
  const firstDesire = desireForWhite(colors.get(first.playerId) ?? []);
  const secondDesire = desireForWhite(colors.get(second.playerId) ?? []);
  return firstDesire >= secondDesire
    ? { white: first, black: second }
    : { white: second, black: first };
}

/** True when this board would force one of the two into a third identical colour. */
function forcesTriple(a: Standing, b: Standing, colors: Map<number, Color[]>): boolean {
  const first = colors.get(a.playerId) ?? [];
  const second = colors.get(b.playerId) ?? [];
  return (
    trailingStreak(first) >= 2 &&
    trailingStreak(second) >= 2 &&
    first[first.length - 1] === second[second.length - 1]
  );
}

/**
 * Colour balance is decided by the pairing, not only by the assignment. When
 * both players on a board are already on a run of two of the same colour,
 * whoever takes black is forced into a third. Swapping partners with a
 * neighbouring board resolves it without disturbing the score groups.
 */
function avoidColourClashes(
  pairs: [Standing, Standing][],
  colors: Map<number, Color[]>,
  hasPlayed: (a: number, b: number) => boolean,
) {
  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = 0; j < pairs.length; j += 1) {
      if (i === j) continue;
      if (!forcesTriple(pairs[i][0], pairs[i][1], colors)) break;

      let resolved = false;
      for (const k of [0, 1] as const) {
        const incoming = pairs[j][k];
        const replaced = pairs[j][1 - k];
        const outgoing = pairs[i][1];

        if (hasPlayed(pairs[i][0].playerId, incoming.playerId)) continue;
        if (hasPlayed(replaced.playerId, outgoing.playerId)) continue;

        const candidateA: [Standing, Standing] = [pairs[i][0], incoming];
        const candidateB: [Standing, Standing] = [replaced, outgoing];
        if (forcesTriple(candidateA[0], candidateA[1], colors)) continue;
        if (forcesTriple(candidateB[0], candidateB[1], colors)) continue;

        pairs[i] = candidateA;
        pairs[j] = candidateB;
        resolved = true;
        break;
      }
      if (resolved) break;
    }
  }
}

/* ── Swiss ─────────────────────────────────────────────────────────────── */

const MAX_BACKTRACK_POOL = 40;

function greedyPairs(pool: Standing[], hasPlayed: (a: number, b: number) => boolean) {
  const remaining = [...pool];
  const out: [Standing, Standing][] = [];
  while (remaining.length > 1) {
    const first = remaining.shift()!;
    let pick = remaining.findIndex((other) => !hasPlayed(first.playerId, other.playerId));
    if (pick < 0) pick = 0; // A repeat is better than a hole in the draw.
    const second = remaining.splice(pick, 1)[0];
    out.push([first, second]);
  }
  return out;
}

/**
 * Pairs a pool that is already sorted by score. The first player is matched
 * against the opponent nearest the halfway point, which is what produces the
 * top-half-versus-bottom-half shape of a Swiss draw, and the search backtracks
 * whenever that choice would strand someone with a repeat pairing.
 */
function searchPairs(
  pool: Standing[],
  hasPlayed: (a: number, b: number) => boolean,
): [Standing, Standing][] | null {
  if (pool.length === 0) return [];
  if (pool.length < 2) return null;
  if (pool.length > MAX_BACKTRACK_POOL) return greedyPairs(pool, hasPlayed);

  const first = pool[0];
  const half = Math.floor(pool.length / 2);
  const order: number[] = [];
  if (half < pool.length) order.push(half);
  for (let d = 1; d < pool.length; d += 1) {
    if (half + d < pool.length) order.push(half + d);
    if (half - d > 0) order.push(half - d);
  }

  for (const index of order) {
    const opponent = pool[index];
    if (!opponent || opponent.playerId === first.playerId) continue;
    if (hasPlayed(first.playerId, opponent.playerId)) continue;

    const rest = pool.filter((_, i) => i !== 0 && i !== index);
    const tail = searchPairs(rest, hasPlayed);
    if (tail) return [[first, opponent], ...tail];
  }
  return null;
}

export function roundCountForSwiss(playerCount: number): number {
  if (playerCount < 2) return 0;
  return Math.max(1, Math.ceil(Math.log2(playerCount)));
}

export function generateSwissRound(standings: Standing[], round: number): GeneratedPairing[] {
  const active = standings.filter((s) => s.rank > 0);
  if (active.length < 2) return [];

  const played = new Map<number, Set<number>>();
  for (const player of active) {
    played.set(
      player.playerId,
      new Set(player.opponents.filter((id) => id > 0)),
    );
  }
  const hasPlayed = (a: number, b: number) => played.get(a)?.has(b) ?? false;

  // Sorted by score first: the pool order is what makes the draw top-half
  // against bottom-half rather than an arbitrary shuffle.
  const sorted = [...active].sort(
    (a, b) => b.score - a.score || a.seed - b.seed || a.playerId - b.playerId,
  );

  const output: GeneratedPairing[] = [];
  let board = 1;
  const pool = [...sorted];

  /* An odd field means someone must sit out. The bye goes to the lowest-scoring
     player who has not already had one, so nobody receives two while another
     player receives none. */
  if (pool.length % 2 === 1) {
    let byeIndex = -1;
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      if (!pool[i].hadBye) {
        byeIndex = i;
        break;
      }
    }
    if (byeIndex < 0) byeIndex = pool.length - 1;
    const byePlayer = pool.splice(byeIndex, 1)[0];
    output.push({ board, whiteId: byePlayer.playerId, blackId: null, isBye: true });
    board += 1;
  }

  const colors = new Map<number, Color[]>();
  for (const player of active) colors.set(player.playerId, [...player.colors]);

  /* Group by score, floating an odd player down into the next group rather
     than reaching across the whole field. This is what keeps round four from
     pairing the leader against someone on zero. */
  const groups: Standing[][] = [];
  for (const player of pool) {
    const last = groups[groups.length - 1];
    if (last && last[0].score === player.score) last.push(player);
    else groups.push([player]);
  }

  let carry: Standing | null = null;
  const grouped: [Standing, Standing][] = [];
  let groupedOk = true;

  for (const group of groups) {
    const current: Standing[] = carry ? [carry, ...group] : [...group];
    carry = null;
    if (current.length % 2 === 1) {
      carry = current.pop() ?? null; // Lowest scorer in the group floats down.
    }
    const result = searchPairs(current, hasPlayed);
    if (!result) {
      groupedOk = false;
      break;
    }
    grouped.push(...result);
  }
  if (carry) groupedOk = false;

  /* Score groups are the right default — they stop round four from pairing the
     leader against someone still on zero. They can also paint the search into a
     corner: a group whose members have all already met leaves no legal
     arrangement at all. When that happens, re-pair the whole field, where the
     extra freedom is what preserves the no-repeat guarantee. */
  const pairs = groupedOk
    ? grouped
    : (searchPairs(pool, hasPlayed) ?? greedyPairs(pool, hasPlayed));

  avoidColourClashes(pairs, colors, hasPlayed);

  for (const [first, second] of pairs) {
    const { white, black } = assignColor(first, second, colors);
    colors.get(white.playerId)!.push('w');
    colors.get(black.playerId)!.push('b');
    output.push({
      board,
      whiteId: white.playerId,
      blackId: black.playerId,
      isBye: false,
    });
    board += 1;
  }

  return output;
}

/* ── Round robin ───────────────────────────────────────────────────────── */

/**
 * The circle method: one player is fixed and the rest rotate, so every player
 * meets every other exactly once over n-1 rounds.
 */
export function generateRoundRobin(standings: Standing[]): GeneratedPairing[][] {
  const players = [...standings].sort((a, b) => a.seed - b.seed);
  if (players.length < 2) return [];

  const list: (Standing | null)[] =
    players.length % 2 === 1 ? [...players, null] : [...players];
  const size = list.length;

  const fixed = list[0];
  let rotation = list.slice(1);
  const colors = new Map<number, Color[]>();
  for (const player of players) colors.set(player.playerId, []);

  const rounds: GeneratedPairing[][] = [];

  for (let round = 0; round < size - 1; round += 1) {
    const arrangement = [fixed, ...rotation];
    const pairings: GeneratedPairing[] = [];
    let board = 1;

    for (let i = 0; i < size / 2; i += 1) {
      const a = arrangement[i];
      const b = arrangement[size - 1 - i];

      if (a === null || b === null) {
        const player = (a ?? b)!;
        pairings.push({ board, whiteId: player.playerId, blackId: null, isBye: true });
        board += 1;
        continue;
      }

      const { white, black } = assignColor(a, b, colors);
      colors.get(white.playerId)!.push('w');
      colors.get(black.playerId)!.push('b');
      pairings.push({ board, whiteId: white.playerId, blackId: black.playerId, isBye: false });
      board += 1;
    }

    rounds.push(pairings);
    rotation = [rotation[rotation.length - 1], ...rotation.slice(0, -1)];
  }

  return rounds;
}

/** Grid used by the round-robin crosstable view. */
export function buildCrosstable(standings: Standing[], results: ResultInput[]) {
  const byPair = new Map<string, string | null>();
  let maxRound = 0;
  for (const entry of results) {
    if (entry.isBye) continue;
    maxRound = Math.max(maxRound, entry.round);
    if (entry.whiteId == null || entry.blackId == null) continue;
    byPair.set(`${entry.whiteId}:${entry.blackId}`, entry.result);
    byPair.set(`${entry.blackId}:${entry.whiteId}`, entry.result);
  }
  return { byPair, totalRounds: maxRound };
}

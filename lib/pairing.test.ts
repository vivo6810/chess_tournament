import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStandings,
  generateRoundRobin,
  generateSwissRound,
  preferredColor,
  roundCountForSwiss,
  type Color,
  type GeneratedPairing,
  type ResultInput,
  type StandingInput,
} from './pairing.ts';

const players = (count: number): StandingInput[] =>
  Array.from({ length: count }, (_, i) => ({
    playerId: i + 1,
    name: `Player ${i + 1}`,
    seed: i + 1,
    withdrawn: false,
  }));

/**
 * Turns a generated round into results. `lowerSeedWins` flips the outcome so
 * score groups actually separate; keeping it deterministic is what makes the
 * colour-balance and no-repeat assertions meaningful rather than lucky.
 */
function toResults(
  pairings: GeneratedPairing[],
  round: number,
  lowerSeedWins = true,
): ResultInput[] {
  return pairings.map((pairing) => {
    const { whiteId, blackId, isBye, board } = pairing;
    let result: string | null = null;
    if (!isBye && whiteId != null && blackId != null) {
      const lowerSeedIsWhite = whiteId < blackId;
      result = lowerSeedIsWhite === lowerSeedWins ? '1-0' : '0-1';
    }
    return {
      playerId: whiteId ?? blackId!,
      round,
      board,
      whiteId,
      blackId,
      isBye,
      result,
    };
  });
}

test('roundCountForSwiss follows ceil(log2 n), floored at one', () => {
  assert.equal(roundCountForSwiss(2), 1);
  assert.equal(roundCountForSwiss(3), 2);
  assert.equal(roundCountForSwiss(4), 2);
  assert.equal(roundCountForSwiss(8), 3);
  assert.equal(roundCountForSwiss(9), 4);
  assert.equal(roundCountForSwiss(16), 4);
  assert.equal(roundCountForSwiss(17), 5);
  assert.equal(roundCountForSwiss(1), 0);
});

test('computeStandings awards points, tracks colours, and scores Buchholz', () => {
  const results: ResultInput[] = [
    { playerId: 1, round: 1, board: 1, whiteId: 1, blackId: 2, isBye: false, result: '1-0' },
    { playerId: 3, round: 1, board: 2, whiteId: 3, blackId: 4, isBye: false, result: '1/2-1/2' },
  ];
  const table = computeStandings(players(4), results);

  const one = table.find((s) => s.playerId === 1)!;
  const two = table.find((s) => s.playerId === 2)!;
  const three = table.find((s) => s.playerId === 3)!;

  assert.equal(one.score, 1);
  assert.equal(one.wins, 1);
  assert.deepEqual(one.colors, ['w']);
  assert.equal(two.score, 0);
  assert.deepEqual(two.colors, ['b']);
  assert.equal(three.score, 0.5);

  // Buchholz is the sum of your opponents' final scores.
  assert.equal(one.buchholz, 0);
  assert.equal(two.buchholz, 1);
  assert.equal(three.buchholz, 0.5);
});

test('Sonneborn-Berger weights an opponent by the points taken off them', () => {
  const results: ResultInput[] = [
    { playerId: 1, round: 1, board: 1, whiteId: 1, blackId: 2, isBye: false, result: '1-0' },
    { playerId: 1, round: 2, board: 1, whiteId: 3, blackId: 1, isBye: false, result: '1/2-1/2' },
  ];
  const table = computeStandings(players(3), results);
  const one = table.find((s) => s.playerId === 1)!;

  // Beat player 2 (finished on 0), drew with player 3 (finished on 0.5).
  assert.equal(one.sonnebornBerger, 1 * 0 + 0.5 * 0.5);
});

test('a bye scores a full point and is recorded', () => {
  const results: ResultInput[] = [
    { playerId: 1, round: 1, board: 1, whiteId: 1, blackId: null, isBye: true, result: null },
  ];
  const table = computeStandings(players(3), results);
  const one = table.find((s) => s.playerId === 1)!;
  assert.equal(one.score, 1);
  assert.equal(one.hadBye, true);
  assert.equal(one.played, 1);
});

test('preferredColor balances counts before it alternates', () => {
  assert.equal(preferredColor([]), null);
  assert.equal(preferredColor(['w', 'w']), 'b');
  assert.equal(preferredColor(['b', 'b']), 'w');
  assert.equal(preferredColor(['w', 'b']), 'w');
  assert.equal(preferredColor(['b', 'w']), 'b');
  // Two more blacks than whites is a hard claim on white.
  assert.equal(preferredColor(['b', 'b', 'b']), 'w');
});

test('Swiss never repeats a pairing across a full event', () => {
  const field = players(12);
  const rounds = roundCountForSwiss(field.length);
  let results: ResultInput[] = [];
  const seen = new Map<string, number>();

  for (let round = 1; round <= rounds; round += 1) {
    const standings = computeStandings(field, results);
    const pairings = generateSwissRound(standings, round);

    const onBoard = pairings.filter((p) => !p.isBye);
    assert.equal(onBoard.length, field.length / 2, `round ${round} should fill every board`);

    for (const pairing of pairings) {
      if (pairing.isBye) continue;
      const key = [pairing.whiteId, pairing.blackId].sort((a, b) => a! - b!).join('-');
      assert.equal(seen.get(key), undefined, `pairing ${key} repeated in round ${round}`);
      seen.set(key, round);
    }

    // Flip the outcome each round so the score groups reshape.
    results = [...results, ...toResults(pairings, round, round % 2 === 1)];
  }
});

test('Swiss gives every player at most one bye', () => {
  const field = players(7);
  const rounds = roundCountForSwiss(field.length);
  let results: ResultInput[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const standings = computeStandings(field, results);
    const pairings = generateSwissRound(standings, round);

    const byes = pairings.filter((p) => p.isBye);
    assert.equal(byes.length, 1, `round ${round} should produce exactly one bye`);

    results = [...results, ...toResults(pairings, round, true)];
    const byeCounts = computeStandings(field, results).filter((s) => s.hadBye);
    assert.equal(byeCounts.length, round, `after round ${round}, ${round} players hold a bye`);
  }
});

test('Swiss never gives a player three of the same colour in a row', () => {
  const field = players(10);
  const rounds = roundCountForSwiss(field.length);
  let results: ResultInput[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const standings = computeStandings(field, results);
    const pairings = generateSwissRound(standings, round);
    results = [...results, ...toResults(pairings, round, round % 2 === 1)];

    const table = computeStandings(field, results);
    for (const player of table) {
      for (let i = 2; i < player.colors.length; i += 1) {
        const run = [player.colors[i - 2], player.colors[i - 1], player.colors[i]];
        const allSame = run.every((c) => c === run[0]);
        assert.equal(
          allSame,
          false,
          `player ${player.playerId} got three ${run[0]} in rounds ${i - 1}-${i + 1}`,
        );
      }
    }
  }
});

test('round robin pairs every player with every other exactly once', () => {
  const field = players(6);
  const standings = computeStandings(field, []);
  const rounds = generateRoundRobin(standings);

  assert.equal(rounds.length, 5, 'six players need five rounds');

  const seen = new Set<string>();
  for (const [index, round] of rounds.entries()) {
    assert.equal(round.length, 3, `round ${index + 1} should have three boards`);
    for (const pairing of round) {
      assert.equal(pairing.isBye, false, 'an even field needs no byes');
      const key = [pairing.whiteId, pairing.blackId].sort((a, b) => a! - b!).join('-');
      assert.equal(seen.has(key), false, `duplicate meeting ${key}`);
      seen.add(key);
    }
  }
  assert.equal(seen.size, (6 * 5) / 2, 'fifteen distinct meetings');
});

test('round robin balances colours for an even field', () => {
  const field = players(6);
  const rounds = generateRoundRobin(computeStandings(field, []));
  const colors = new Map<number, Color[]>();
  for (const player of field) colors.set(player.playerId, []);

  for (const round of rounds) {
    for (const pairing of round) {
      colors.get(pairing.whiteId!)!.push('w');
      colors.get(pairing.blackId!)!.push('b');
    }
  }

  for (const [, list] of colors) {
    const whites = list.filter((c) => c === 'w').length;
    const blacks = list.length - whites;
    assert.ok(Math.abs(whites - blacks) <= 1, `colour split was ${whites}/${blacks}`);
  }
});

test('an odd round robin field hands out one bye per round', () => {
  const field = players(5);
  const rounds = generateRoundRobin(computeStandings(field, []));
  assert.equal(rounds.length, 5);

  const byes = new Map<number, number>();
  for (const round of rounds) {
    const roundByes = round.filter((p) => p.isBye);
    assert.equal(roundByes.length, 1);
    for (const pairing of roundByes) {
      const id = pairing.whiteId!;
      byes.set(id, (byes.get(id) ?? 0) + 1);
    }
  }
  // Five byes across five players: everyone sits out exactly once.
  assert.equal(byes.size, 5);
  for (const [, count] of byes) assert.equal(count, 1);
});

test('round one pairs the top half against the bottom half', () => {
  const standings = computeStandings(players(8), []);
  const pairings = generateSwissRound(standings, 1);
  const boards = pairings.map((p) => [p.whiteId, p.blackId].sort((a, b) => a! - b!).join('v'));
  assert.deepEqual(boards, ['1v5', '2v6', '3v7', '4v8']);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fenAfter,
  isLegalMove,
  isPromotion,
  isTapEcho,
  kingSquare,
  matedSide,
  outcomeFor,
  premoveFen,
  resolveDrop,
  resolveTap,
  sideOn,
  takeNextPremove,
  TAP_ECHO_MS,
  targetsFrom,
  withTurn,
} from './chess-ui.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* ── Ordinary moves ────────────────────────────────────────────── */

test('a knight has two targets from the start', () => {
  const targets = targetsFrom(START, 'g1');
  assert.deepEqual(targets.map((t) => t.to).sort(), ['f3', 'h3']);
  assert.ok(targets.every((t) => !t.capture && !t.promotion && t.castle === null));
});

test('a blocked pawn has no targets and a free one has two', () => {
  assert.deepEqual(targetsFrom(START, 'e2').map((t) => t.to), ['e3', 'e4']);
  /* A white pawn on e6 stands directly in front of the black e7 pawn. */
  const blocked = 'rnbqkbnr/pppppppp/4P3/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  assert.deepEqual(targetsFrom(blocked, 'e7'), []);
});

test('captures are marked, quiet moves are not', () => {
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
  const targets = targetsFrom(fen, 'e4');
  const capture = targets.find((t) => t.to === 'd5');
  const quiet = targets.find((t) => t.to === 'e5');
  assert.equal(capture?.capture, true);
  assert.equal(quiet?.capture, false);
});

test('a square that is not a square returns nothing instead of throwing', () => {
  assert.deepEqual(targetsFrom(START, 'z9'), []);
  assert.deepEqual(targetsFrom('not a fen', 'e2'), []);
});

/* ── The three moves people assume are broken ──────────────────── */

test('castling is offered on both sides and labelled', () => {
  const both = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const targets = targetsFrom(both, 'e1');
  const king = targets.find((t) => t.to === 'g1');
  const queen = targets.find((t) => t.to === 'c1');
  assert.equal(king?.castle, 'king');
  assert.equal(queen?.castle, 'queen');
  /* Castling is not a capture, even though the rook travels. */
  assert.equal(king?.capture, false);
});

test('castling disappears when the path is attacked or blocked', () => {
  /* Bishop on f1 blocks the king's side but not the queen's. */
  const blocked = 'r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1';
  const targets = targetsFrom(blocked, 'e1');
  assert.equal(targets.some((t) => t.castle === 'king'), false);
  assert.equal(targets.some((t) => t.castle === 'queen'), true);

  /* Queen on f2 gives check, so neither side can castle out of it. */
  const attacked = 'r3k2r/8/8/8/8/8/5q2/R3K2R w KQkq - 0 1';
  assert.equal(targetsFrom(attacked, 'e1').some((t) => t.castle), false);
});

test('en passant is a capture onto an empty square', () => {
  /* White pawn e5, black just played d7-d5. */
  const fen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
  const ep = targetsFrom(fen, 'e5').find((t) => t.to === 'd6');
  assert.ok(ep, 'en passant target missing');
  assert.equal(ep!.enPassant, true);
  assert.equal(ep!.capture, true);
});

test('promotion collapses four moves into one square', () => {
  const fen = '8/P7/8/8/8/8/8/k6K w - - 0 1';
  const targets = targetsFrom(fen, 'a7');
  assert.equal(targets.length, 1, 'four promotion moves must not draw four markers');
  assert.equal(targets[0].to, 'a8');
  assert.equal(targets[0].promotion, true);
  assert.equal(isPromotion(fen, 'a7', 'a8'), true);
  assert.equal(isPromotion(fen, 'a7', 'b8'), false);
});

/* ── Premoves ──────────────────────────────────────────────────── */

test('turning the position over lets a player plan while waiting', () => {
  /* It is black's move; white still has to be able to see white's targets. */
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  assert.deepEqual(targetsFrom(fen, 'e4'), []);
  assert.deepEqual(targetsFrom(fen, 'd2', 'w').map((t) => t.to).sort(), ['d3', 'd4']);
});

test('withTurn rewrites the mover and drops the en passant square', () => {
  assert.equal(withTurn(START, 'b'), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1');
});

test('a premove queue replays our moves and hands the turn back', () => {
  const afterE4 = premoveFen(START, [{ from: 'e2', to: 'e4' }], 'w');
  assert.match(afterE4, /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b/);

  /* Two premoves: the second is planned as if the opponent had replied. */
  const queued = premoveFen(
    START,
    [
      { from: 'e2', to: 'e4' },
      { from: 'g1', to: 'f3' },
    ],
    'w',
  );
  assert.match(queued, /5N2/, 'the knight should have reached f3 in the preview');
  assert.match(queued, / b KQkq/, 'and the move must be handed back to the opponent');
});

test('an illegal premove stops the replay instead of corrupting it', () => {
  const queued = premoveFen(START, [{ from: 'e2', to: 'e5' }], 'w');
  assert.match(queued, /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPP/);
});

/* ── Castling ────────────────────────────────────────────────────
   Every rule a king has to satisfy to castle, asked the way the boards ask
   it. The reported bug was a castle being played in a position where an enemy
   knight had taken one of those rules away, so each rule gets its own case. */

const OPEN_ROOKS = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

/** Knight on d2: it attacks f1, the square a kingside castle crosses. */
const KNIGHT_ON_D2 = 'r3k2r/8/8/8/8/8/3n4/R3K2R w KQkq - 0 1';

/** Black rook down the open e-file: white is in check. */
const IN_CHECK = '4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1';

/** Own bishop on f1: the king has somewhere to be but no way through. */
const F1_OCCUPIED = '4k3/8/8/8/8/8/8/R3KB1R w KQ - 0 1';

/** The right itself was lost — the FEN no longer carries `K`. */
const NO_RIGHTS = '4k3/8/8/8/8/8/8/R3K2R w k - 0 1';

test('a castle is offered when the king has a clear, safe path', () => {
  const targets = targetsFrom(OPEN_ROOKS, 'e1');
  assert.equal(targets.find((t) => t.to === 'g1')?.castle, 'king');
  assert.equal(targets.find((t) => t.to === 'c1')?.castle, 'queen');
  assert.equal(isLegalMove(OPEN_ROOKS, 'e1', 'g1'), true);
});

test('no castle through a square an enemy knight attacks', () => {
  /* d2 is not check — the king is safe where it stands — but f1 is covered. */
  const targets = targetsFrom(KNIGHT_ON_D2, 'e1');
  assert.equal(
    targets.some((t) => t.castle === 'king'),
    false,
    'the king would walk across f1, which the knight on d2 attacks',
  );
  assert.equal(isLegalMove(KNIGHT_ON_D2, 'e1', 'g1'), false);
  assert.equal(fenAfter(KNIGHT_ON_D2, 'e1', 'g1'), null);
});

test('no castle out of check, onto an attacked square, through a piece, or without rights', () => {
  assert.equal(isLegalMove(IN_CHECK, 'e1', 'g1'), false, 'in check');
  assert.equal(isLegalMove(F1_OCCUPIED, 'e1', 'g1'), false, 'f1 occupied');
  assert.equal(isLegalMove(NO_RIGHTS, 'e1', 'g1'), false, 'right already given up');
});

test('a premoved castle the reply has taken away is dropped, not played', () => {
  /* While black is thinking, white plans O-O. That is checked against the
     position white will be moving in, so the plan is sound when it is made. */
  const planned = withTurn(OPEN_ROOKS, 'w');
  assert.equal(isLegalMove(planned, 'e1', 'g1'), true);

  /* Black answers ...Nd2. The guess did not come off: f1 is attacked now, and
     the queued move has to be judged again in the real position. */
  const afterReply = KNIGHT_ON_D2;
  assert.deepEqual(takeNextPremove(afterReply, [{ from: 'e1', to: 'g1' }]), {
    status: 'illegal',
  });
});

test('a premove that is still legal is played, and hands back the rest', () => {
  const queue = [
    { from: 'e2', to: 'e4' },
    { from: 'g1', to: 'f3' },
  ];
  const afterBlack = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2';
  const step = takeNextPremove(afterBlack, queue);

  assert.equal(step.status, 'play');
  if (step.status !== 'play') return;
  assert.deepEqual(step.move, { from: 'e2', to: 'e4' });
  assert.deepEqual(step.rest, [{ from: 'g1', to: 'f3' }]);
  assert.match(step.fen, /\/4P3\/8\/PPPP1PPP/);
});

test('an empty premove queue is not an illegal one', () => {
  assert.deepEqual(takeNextPremove(OPEN_ROOKS, []), { status: 'empty' });
});

test('a pinned piece is only offered the squares that keep the king safe', () => {
  /* Rook e2 in front of its own king, black rook on e8: sideways is suicide. */
  const pinned = '4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1';
  assert.deepEqual(targetsFrom(pinned, 'e2').map((t) => t.to).sort(), [
    'e3',
    'e4',
    'e5',
    'e6',
    'e7',
    'e8',
  ]);
  assert.equal(isLegalMove(pinned, 'e2', 'd2'), false);
});

/* ── Reading the result ────────────────────────────────────────── */

test('a win and a loss read differently for each side of the same game', () => {
  const white = outcomeFor('1-0', 'checkmate', 'w');
  const black = outcomeFor('1-0', 'checkmate', 'b');
  assert.equal(white?.kind, 'win');
  assert.equal(black?.kind, 'loss');
  assert.equal(white?.detail, 'Checkmate');
});

test('a draw says what kind of draw it was', () => {
  assert.equal(outcomeFor('1/2-1/2', 'stalemate', 'w')?.detail, 'Stalemate — no legal moves');
  assert.equal(outcomeFor('1/2-1/2', 'insufficient', 'b')?.detail, 'Insufficient material');
  assert.equal(outcomeFor('1/2-1/2', 'agreement', 'w')?.title, 'Draw');
});

test('an unfinished game has no outcome', () => {
  assert.equal(outcomeFor(null, null, 'w'), null);
});

test('a spectator gets the winner by name, not "you"', () => {
  assert.equal(outcomeFor('0-1', 'resignation', null)?.title, 'Black won');
  assert.equal(outcomeFor('1-0', 'checkmate', null)?.title, 'White won');
  assert.equal(outcomeFor('1/2-1/2', 'agreement', null)?.title, 'Draw');
});

/* ── The falling king ──────────────────────────────────────────── */

/* Fool's mate: white is mated and white is to move in the final position. */
const FOOLS_MATE = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

test('only a checkmate topples a king, and it is the mated one', () => {
  assert.equal(matedSide(FOOLS_MATE, 'checkmate'), 'w');
  assert.equal(matedSide(FOOLS_MATE, 'resignation'), null, 'a resignation is not a mate');
  assert.equal(matedSide(FOOLS_MATE, 'timeout'), null);
  assert.equal(matedSide(START, 'checkmate'), null, 'the start position is not mate');
  assert.equal(matedSide('garbage', 'checkmate'), null);
});

/* ── Tap to move ───────────────────────────────────────────────── */

test('a tap on a marked square plays the selected move', () => {
  const targets = targetsFrom(START, 'e2');
  assert.deepEqual(
    resolveTap({ fen: START, square: 'e4', side: 'w', selected: 'e2', targets }),
    { type: 'play', from: 'e2', to: 'e4' },
  );
});

test('a tap on your own piece selects it, and tapping it again lets go', () => {
  assert.deepEqual(
    resolveTap({ fen: START, square: 'g1', side: 'w', selected: null, targets: [] }),
    { type: 'select', square: 'g1' },
  );
  assert.deepEqual(
    resolveTap({ fen: START, square: 'g1', side: 'w', selected: 'g1', targets: [] }),
    { type: 'deselect' },
  );
});

test('a tap that is neither clears the selection', () => {
  const targets = targetsFrom(START, 'e2');
  /* An opponent piece is not a legal landing square from e2. */
  assert.deepEqual(
    resolveTap({ fen: START, square: 'e7', side: 'w', selected: 'e2', targets }),
    { type: 'deselect' },
  );
  /* Nor is an empty square that the selected piece cannot reach. */
  assert.deepEqual(
    resolveTap({ fen: START, square: 'e5', side: 'w', selected: 'e2', targets }),
    { type: 'deselect' },
  );
});

test('a promotion tap is still just a tap onto the last rank', () => {
  const fen = '8/P7/8/8/8/8/8/k6K w - - 0 1';
  const targets = targetsFrom(fen, 'a7');
  assert.deepEqual(
    resolveTap({ fen, square: 'a8', side: 'w', selected: 'a7', targets }),
    { type: 'play', from: 'a7', to: 'a8' },
  );
});

test('one physical tap reported twice is only handled once', () => {
  /* The pattern that made the board feel dead on a phone: a drag that ended
     where it started, then the click that follows it. */
  const first = { square: 'e2', at: 10_000 };
  assert.equal(isTapEcho(first, 'e2', 10_030), true);
  assert.equal(isTapEcho(first, 'e2', 10_000 + TAP_ECHO_MS), true, 'the edge of the window counts');

  /* A different square is the player moving on, not an echo. */
  assert.equal(isTapEcho(first, 'e4', 10_020), false);
  /* And a deliberate second tap later is real. */
  assert.equal(isTapEcho(first, 'e2', 10_000 + TAP_ECHO_MS + 1), false);
  assert.equal(isTapEcho(null, 'e2', 10_000), false, 'nothing to echo yet');
  /* Clock skew that would read as the past must not swallow a tap. */
  assert.equal(isTapEcho(first, 'e2', 9_000), false);
});

test('a drag that ends where it started is the tap it drifted from', () => {
  assert.deepEqual(resolveDrop('e2', 'e2'), { type: 'tap', square: 'e2' });
  assert.deepEqual(resolveDrop('e2', 'e4'), { type: 'move', from: 'e2', to: 'e4' });
  /* Dropping back onto the tray, or off the board, is not an instruction. */
  assert.deepEqual(resolveDrop('e2', null), { type: 'ignore' });
  assert.deepEqual(resolveDrop('tray', 'e4'), { type: 'ignore' });
});

/* ── Squares ───────────────────────────────────────────────────── */

test('sideOn and kingSquare read the board', () => {
  assert.equal(sideOn(START, 'e1'), 'w');
  assert.equal(sideOn(START, 'e5'), null);
  assert.equal(kingSquare(START, 'w'), 'e1');
  assert.equal(kingSquare(START, 'b'), 'e8');
});

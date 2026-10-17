#!/usr/bin/env bash
# End-to-end smoke test.
#
# Exercises the paths a host and two players actually take: register, take a
# username, create a 7-player Swiss event (odd count, so the bye logic is live),
# start it, try to advance too early, then create a second event between two
# real accounts and play it.
#
#   ./scripts/smoke-test.sh              # own server, throwaway database
#   ./scripts/smoke-test.sh <base-url>   # a server you already have running
#
# The default matters. These checks create accounts and tournaments, and an
# earlier version ran them against the development database — so a run left a
# "Smoke Test Open" event on the public tournaments page, hosted by
# `smoke<timestamp>`, for as long as nobody deleted it. The fix is not a bigger
# cleanup: it is never touching that database. By default the script starts its
# own dev server on SMOKE_PORT with DATABASE_PATH inside a mktemp directory,
# and deletes the lot on exit. Two dev servers cannot share the `.next`
# directory, so stop your own server before running this — the script prints its
# server's log if it fails to come up.

set -uo pipefail

EXTERNAL_BASE="${1:-}"
PORT="${SMOKE_PORT:-3123}"
BASE="${EXTERNAL_BASE:-http://127.0.0.1:$PORT}"
SERVER_PID=""
JAR="$(mktemp)"
JAR_A="$(mktemp)"
JAR_B="$(mktemp)"
TMP="$(mktemp -d)"
STAMP="$(date +%s)"
USER="smoke${STAMP}"
PLAYER_A="smokea${STAMP}"
PLAYER_B="smokeb${STAMP}"
PASS="correct-horse-battery"
FAILED=0

# `next dev` starts the actual server in a grandchild, so killing the PID we
# spawned leaves it holding the port. Walk the tree instead.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null
}

cleanup() {
  rm -f "$JAR" "$JAR_A" "$JAR_B"
  if [ -n "$SERVER_PID" ]; then
    kill_tree "$SERVER_PID"
    wait "$SERVER_PID" 2>/dev/null
  fi
  rm -rf "$TMP"
  # Only reachable when pointed at someone else's server. Our own database is
  # inside $TMP and has just been deleted with it.
  [ -n "$EXTERNAL_BASE" ] && purge
}

# The checks run against a real server, so they leave real rows behind: another
# "Smoke Test Open" on the public tournaments page on every run. This deletes
# exactly the accounts the run created, and the events they hosted; players,
# pairings and games follow by foreign key. Set DATABASE_PATH if the server was
# started with one — otherwise it assumes the default file next to this script.
purge() {
  local root db
  root="$(cd "$(dirname "$0")/.." && pwd)"
  db="${DATABASE_PATH:-$root/data/arbiter.db}"
  node "$root/scripts/purge-smoke.mjs" "$db" "$USER" "$PLAYER_A" "$PLAYER_B"
}
trap cleanup EXIT

start_server() {
  local root
  root="$(cd "$(dirname "$0")/.." && pwd)"
  printf '\n\033[1mStarting a disposable server on port %s\033[0m\n' "$PORT"
  ( cd "$root" && exec env DATABASE_PATH="$TMP/arbiter.db" NEXT_TELEMETRY_DISABLED=1 \
      npx next dev -H 127.0.0.1 -p "$PORT" > "$TMP/server.log" 2>&1 ) &
  SERVER_PID=$!

  local i
  for i in $(seq 1 60); do
    if curl -s -o /dev/null "$BASE/"; then return 0; fi
    sleep 1
  done

  printf 'The server did not answer after 60s. Its log:\n'
  tail -20 "$TMP/server.log"
  exit 1
}

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
check() {
  if [ "$2" = "$3" ]; then
    printf '  ok    %-40s %s\n' "$1" "$2"
  else
    printf '  FAIL  %-40s got %s, wanted %s\n' "$1" "$2" "$3"
    FAILED=1
  fi
}

code() { curl -s -o "$2" -w '%{http_code}' "${@:3}"; }
register() {
  code "$BASE" "$2" -c "$3" -X POST "$BASE/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$PASS\"}"
}

[ -z "$EXTERNAL_BASE" ] && start_server

step "Register a host and two players"
STATUS=$(register "$USER" "$TMP/host.json" "$JAR")
check "POST /api/auth/register (host)" "$STATUS" "200"
STATUS=$(register "$PLAYER_A" "$TMP/a.json" "$JAR_A")
check "POST /api/auth/register (A)" "$STATUS" "200"
STATUS=$(register "$PLAYER_B" "$TMP/b.json" "$JAR_B")
check "POST /api/auth/register (B)" "$STATUS" "200"

step "A taken username cannot be chosen, in any case"
STATUS=$(register "$USER" "$TMP/dupe.json" "$TMP/none")
check "exact duplicate rejected" "$STATUS" "409"
STATUS=$(register "$(echo "$USER" | tr '[:lower:]' '[:upper:]')" "$TMP/dupe2.json" "$TMP/none")
check "different case also rejected" "$STATUS" "409"
STATUS=$(code "$BASE" "$TMP/weak.json" -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' -d '{"username":"weakling","password":"short"}')
check "short password rejected" "$STATUS" "400"

step "Create a 7-player Swiss event"
STATUS=$(code "$BASE" "$TMP/create.json" -b "$JAR" -X POST "$BASE/api/tournaments" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Test Open","format":"swiss","timeControl":"3+2","players":["Dana Whitfield","Tomas Berglund","Priya Raghunathan","Marcus Okonkwo","Ines Alvarado","Kenji Nakamura","Sofia Marchetti"]}')
check "POST /api/tournaments" "$STATUS" "201"
SLUG=$(node -e "process.stdout.write(require('$TMP/create.json').tournament.slug)")

step "Draw round one"
STATUS=$(code "$BASE" "$TMP/early.json" -b "$JAR" -X POST "$BASE/api/tournaments/$SLUG/start")
check "POST .../start" "$STATUS" "200"
BYES=$(node -e "process.stdout.write(String(require('$TMP/early.json').pairings.filter((p) => p.pairing.is_bye).length))")
check "bye count in round 1" "$BYES" "1"
BOARDS=$(node -e "process.stdout.write(String(require('$TMP/early.json').pairings.length))")
check "boards including the bye" "$BOARDS" "4"
GID=$(node -e "
const d = require('$TMP/early.json');
process.stdout.write(String(d.pairings.find((p) => !p.pairing.is_bye && p.game).game.id));
")

step "Advancing with games running must be refused"
STATUS=$(code "$BASE" "$TMP/advance.json" -b "$JAR" -X POST "$BASE/api/tournaments/$SLUG/advance")
check "POST .../advance while running" "$STATUS" "400"

step "Hosting is not playing"
# The field here is typed-in names with no accounts behind them, so this game
# belongs to nobody. The host runs the event; that does not make them a player.
STATUS=$(code "$BASE" "$TMP/hostmove.json" -b "$JAR" -X POST "$BASE/api/games/$GID/move" \
  -H 'Content-Type: application/json' -d '{"from":"e2","to":"e4"}')
check "a non-seated host cannot move" "$STATUS" "403"
STATUS=$(code "$BASE" "$TMP/anon.json" -X POST "$BASE/api/games/$GID/move" \
  -H 'Content-Type: application/json' -d '{"from":"e7","to":"e5"}')
check "an anonymous move is rejected" "$STATUS" "401"

step "Nothing has moved yet"
curl -s -b "$JAR" "$BASE/api/games/$GID" -o "$TMP/state.json"
MOVES=$(node -e "process.stdout.write(String(require('$TMP/state.json').game.moves.length))")
check "move count in state" "$MOVES" "0"
CONTROL=$(node -e "process.stdout.write(require('$TMP/state.json').game.timeControl.id)")
check "time control propagated" "$CONTROL" "3+2"
SEATED=$(node -e "process.stdout.write(String(require('$TMP/state.json').seats.seated))")
check "the host is not seated" "$SEATED" "false"

step "A resign by the host still ends the game"
STATUS=$(code "$BASE" "$TMP/resign.json" -b "$JAR" -X POST "$BASE/api/games/$GID/action" \
  -H 'Content-Type: application/json' -d '{"action":"resign","side":"white"}')
check "POST .../action resign" "$STATUS" "200"
RESULT=$(node -e "process.stdout.write(require('$TMP/resign.json').result)")
check "resignation scores it" "$RESULT" "0-1"

step "Rejected without a session"
STATUS=$(code "$BASE" "$TMP/noauth.json" -X POST "$BASE/api/tournaments/$SLUG/advance")
check "anonymous advance rejected" "$STATUS" "401"

step "The bye is worth a full point in the standings"
STANDING=$(node -e "
const d = require('$TMP/early.json');
const bye = d.pairings.find((p) => p.pairing.is_bye);
const top = d.standings.find((s) => s.playerId === bye.pairing.white_id);
process.stdout.write(String(top.score));
")
check "bye player's score" "$STANDING" "1"

# ── A game two real accounts can actually play ─────────────────────────
#
# The event above proves the guard. This one proves the door: a host enters two
# usernames, those usernames resolve to accounts, and those accounts can move.

step "Create an untimed event between two accounts"
STATUS=$(code "$BASE" "$TMP/untimed.json" -b "$JAR" -X POST "$BASE/api/tournaments" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Untimed\",\"format\":\"round_robin\",\"timeControl\":\"untimed\",\"players\":[\"$PLAYER_A\",\"$PLAYER_B\"]}")
check "POST /api/tournaments (untimed)" "$STATUS" "201"
USLUG=$(node -e "process.stdout.write(require('$TMP/untimed.json').tournament.slug)")

STATUS=$(code "$BASE" "$TMP/ustart.json" -b "$JAR" -X POST "$BASE/api/tournaments/$USLUG/start")
check "POST .../start (untimed)" "$STATUS" "200"

UGID=$(node -e "
const d = require('$TMP/ustart.json');
process.stdout.write(String(d.pairings.find((p) => p.game).game.id));
")
WHITE=$(node -e "
const d = require('$TMP/ustart.json');
process.stdout.write(d.pairings.find((p) => p.game).whiteName);
")
if [ "$WHITE" = "$PLAYER_A" ]; then WJAR="$JAR_A"; BJAR="$JAR_B"; else WJAR="$JAR_B"; BJAR="$JAR_A"; fi

step "The two accounts hold the seats"
curl -s -b "$WJAR" "$BASE/api/games/$UGID" -o "$TMP/useat.json"
SEATED=$(node -e "process.stdout.write(String(require('$TMP/useat.json').seats.seated))")
check "the white player is seated" "$SEATED" "true"
MODE=$(node -e "process.stdout.write(require('$TMP/useat.json').game.timeControl.mode)")
check "time control mode" "$MODE" "none"

step "The seated players can move"
STATUS=$(code "$BASE" "$TMP/umove.json" -b "$WJAR" -X POST "$BASE/api/games/$UGID/move" \
  -H 'Content-Type: application/json' -d '{"from":"e2","to":"e4"}')
check "POST .../move e2e4 as white" "$STATUS" "200"
SAN=$(node -e "process.stdout.write(require('$TMP/umove.json').san)")
check "move recorded as SAN" "$SAN" "e4"

step "A seated player cannot move for the other side"
STATUS=$(code "$BASE" "$TMP/wrongside.json" -b "$WJAR" -X POST "$BASE/api/games/$UGID/move" \
  -H 'Content-Type: application/json' -d '{"from":"e7","to":"e5"}')
check "white cannot play black's move" "$STATUS" "403"

step "An illegal move from the side to move is rejected"
STATUS=$(code "$BASE" "$TMP/illegal.json" -b "$BJAR" -X POST "$BASE/api/games/$UGID/move" \
  -H 'Content-Type: application/json' -d '{"from":"e7","to":"e4"}')
check "illegal move rejected" "$STATUS" "400"

step "An untimed game has no clock and cannot flag"
# Two seconds on a zero bank. Any other control in the list would have flagged
# the mover before this response came back.
sleep 2
STATUS=$(code "$BASE" "$TMP/bmove.json" -b "$BJAR" -X POST "$BASE/api/games/$UGID/move" \
  -H 'Content-Type: application/json' -d '{"from":"e7","to":"e5"}')
check "black moves after 2s on a zero bank" "$STATUS" "200"
curl -s "$BASE/api/games/$UGID" -o "$TMP/uend.json"
BANK=$(node -e "
const c = require('$TMP/uend.json').clock;
process.stdout.write(String(c.whiteMs + c.blackMs));
")
check "no time was consumed" "$BANK" "0"
STATE=$(node -e "process.stdout.write(require('$TMP/uend.json').game.status)")
check "still in play, not flagged" "$STATE" "active"

# ── Draw offers ────────────────────────────────────────────────────────
#
# The board's draw button talks to these three actions, and a draw is an
# agreement: one player offering must not end the game, and the offerer must
# not be allowed to answer their own offer.

step "A draw offer has to be answered by the other player"
STATUS=$(code "$BASE" "$TMP/offer.json" -b "$WJAR" -X POST "$BASE/api/games/$UGID/action" \
  -H 'Content-Type: application/json' -d '{"action":"offer_draw"}')
check "POST .../action offer_draw" "$STATUS" "200"
OFFER=$(node -e "process.stdout.write(require('$TMP/offer.json').drawOffer)")
check "the offer is held on the game" "$OFFER" "white"

curl -s "$BASE/api/games/$UGID" -o "$TMP/offered.json"
STILL=$(node -e "process.stdout.write(require('$TMP/offered.json').game.status)")
check "offering does not end the game" "$STILL" "active"

STATUS=$(code "$BASE" "$TMP/own.json" -b "$WJAR" -X POST "$BASE/api/games/$UGID/action" \
  -H 'Content-Type: application/json' -d '{"action":"accept_draw"}')
check "answering your own offer is refused" "$STATUS" "400"

STATUS=$(code "$BASE" "$TMP/decline.json" -b "$BJAR" -X POST "$BASE/api/games/$UGID/action" \
  -H 'Content-Type: application/json' -d '{"action":"decline_draw"}')
check "the opponent can decline" "$STATUS" "200"
DECLINED=$(node -e "process.stdout.write(String(require('$TMP/decline.json').drawOffer))")
check "declining clears the offer" "$DECLINED" "null"

STATUS=$(code "$BASE" "$TMP/boffer.json" -b "$BJAR" -X POST "$BASE/api/games/$UGID/action" \
  -H 'Content-Type: application/json' -d '{"action":"offer_draw"}')
check "the other side can offer too" "$STATUS" "200"

STATUS=$(code "$BASE" "$TMP/accept.json" -b "$WJAR" -X POST "$BASE/api/games/$UGID/action" \
  -H 'Content-Type: application/json' -d '{"action":"accept_draw"}')
check "the opponent can accept" "$STATUS" "200"
RESULT=$(node -e "process.stdout.write(require('$TMP/accept.json').result)")
check "an accepted draw scores 1/2-1/2" "$RESULT" "1/2-1/2"
TERM=$(node -e "process.stdout.write(require('$TMP/accept.json').termination)")
check "and is recorded as agreement" "$TERM" "agreement"

step "A finished game takes no more moves"
STATUS=$(code "$BASE" "$TMP/afterdraw.json" -b "$WJAR" -X POST "$BASE/api/games/$UGID/move" \
  -H 'Content-Type: application/json' -d '{"from":"g1","to":"f3"}')
check "POST .../move after a draw" "$STATUS" "400"

# ── Checkmate ──────────────────────────────────────────────────────────
#
# The board topples the mated king, which means the *position* has to say who
# was mated — not the result string, which only says who won.

step "Fool's mate ends the game as a checkmate"
STATUS=$(code "$BASE" "$TMP/mate.json" -b "$JAR" -X POST "$BASE/api/tournaments" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Mate\",\"format\":\"round_robin\",\"timeControl\":\"untimed\",\"players\":[\"$PLAYER_A\",\"$PLAYER_B\"]}")
check "POST /api/tournaments (mate)" "$STATUS" "201"
MSLUG=$(node -e "process.stdout.write(require('$TMP/mate.json').tournament.slug)")

STATUS=$(code "$BASE" "$TMP/mstart.json" -b "$JAR" -X POST "$BASE/api/tournaments/$MSLUG/start")
check "POST .../start (mate)" "$STATUS" "200"
MGID=$(node -e "
const d = require('$TMP/mstart.json');
process.stdout.write(String(d.pairings.find((p) => p.game).game.id));
")
MWHITE=$(node -e "
const d = require('$TMP/mstart.json');
process.stdout.write(d.pairings.find((p) => p.game).whiteName);
")
if [ "$MWHITE" = "$PLAYER_A" ]; then MWJAR="$JAR_A"; MBJAR="$JAR_B"; else MWJAR="$JAR_B"; MBJAR="$JAR_A"; fi

for MV in "f2 f3 $MWJAR" "e7 e5 $MBJAR" "g2 g4 $MWJAR" "d8 h4 $MBJAR"; do
  set -- $MV
  FROM="$1"; TO="$2"; JAR_MOVE="$3"
  STATUS=$(code "$BASE" "$TMP/mv.json" -b "$JAR_MOVE" -X POST "$BASE/api/games/$MGID/move" \
    -H 'Content-Type: application/json' -d "{\"from\":\"$FROM\",\"to\":\"$TO\"}")
  check "move $FROM$TO" "$STATUS" "200"
done

MOVER=$(node -e "process.stdout.write(require('$TMP/mv.json').over.termination)")
check "mate is classified as checkmate" "$MOVER" "checkmate"

curl -s -b "$MWJAR" "$BASE/api/games/$MGID" -o "$TMP/mend.json"
MSTATUS=$(node -e "process.stdout.write(require('$TMP/mend.json').game.status)")
check "the game is finished" "$MSTATUS" "finished"
MRESULT=$(node -e "process.stdout.write(require('$TMP/mend.json').game.result)")
check "black wins on a mated white" "$MRESULT" "0-1"
MTURN=$(node -e "process.stdout.write(require('$TMP/mend.json').game.fen.split(' ')[1])")
check "white is the side to move in the final FEN" "$MTURN" "w"

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32mAll smoke checks passed.\033[0m\n'
else
  printf '\033[31mSome smoke checks failed.\033[0m\n'
fi
exit "$FAILED"

# INIT — read this first

Everything an agent needs to find its way around Arbiter without re-deriving it.
**If a fact here contradicts the code, the code wins — update this file in the same change.**

---

## What this is

A chess tournament host. You create an event, type in the field, start it, and the
pairings generate themselves round by round. Games are played move by move on a live
board with server-authoritative clocks, and finished games can be reviewed with
Stockfish.

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind 4 · SQLite.

---

## Commands

```bash
npm run dev        # dev server. MUST bind 0.0.0.0 in this sandbox: npx next dev --hostname 0.0.0.0 --port 3000
npm test           # node --test lib/*.test.ts   (no framework, no jsdom)
npm run typecheck  # tsc --noEmit
npm run build      # production build
bash scripts/smoke-test.sh [base-url]   # end-to-end against a RUNNING server on :3000
```

Dev-server previews in this sandbox are reached through a proxy, so the browser sends
the preview hostname instead of `localhost`. Next rejects untrusted hosts in dev, so
that hostname must be listed in `allowedDevOrigins` in `next.config.ts`. **The hostname
changes whenever the sandbox is re-provisioned.** If the preview 403s or the page is
blank while `curl 127.0.0.1:3000` works, that list is the first thing to check.

Do not background the dev server inside a one-shot shell command — it is killed when
the tool call returns. Use the shared terminal, or a detached process with the PID
recorded.

---

## Layout

```
app/
  layout.tsx              root shell: fonts, pre-paint theme script, SiteHeader
  globals.css             THE design system. Light + dark tokens, all component CSS
  page.tsx                landing
  login/ register/        auth pages
  tournaments/            list, new, [slug] detail
  games/[id]/             the live board
  analysis/               finished games worth reviewing
  api/                    route handlers — see "API" below

components/
  split-flap-text/        SplitFlapText + .css — Solari display, reusable
  site-header.tsx         the header: gooey pill from md up, drop-down menu below it
  gooey-nav/              GooeyNav + .css — the pill itself (desktop only)
  masked-heading/         MaskedHeading + .css — GSAP heading clipped to media
  game-board.tsx          live game: board, clocks, actions, engine, review
  game-clock.tsx          the split-flap clock (wraps SplitFlapText)
  engine-panel.tsx        single-position Stockfish readout
  game-review.tsx         full-game review: verdicts, accuracy, eval graph
  tournament-controls.tsx host-only: add players, start, advance
  new-tournament-form.tsx create an event
  chess-pieces.tsx        the SVG piece set — the ONE source of piece geometry
  hero-board.tsx          inline board used by the landing heading — same geometry
  self-playing-board.tsx  decorative, replays Morphy 1858
  floating-pieces.tsx     decorative drift

lib/
  db.ts                   SQLite (node:sqlite), schema, migrations-in-place, row types
  auth.ts                 scrypt hashing, sessions, getCurrentUser()
  service.ts              ALL queries and writes. Route handlers call this, not SQL.
  pairing.ts              Swiss + round-robin generation, standings, tiebreaks
  clock.ts                clock arithmetic. Imports NOTHING, on purpose.
  time-controls.ts        THE single source of truth for time controls
  game.ts                 move validation, PGN, accuracy/verdict thresholds
  use-engine.ts           Stockfish Web Worker hook
  use-theme.ts            reads the data-theme attribute (no context/provider)
  api.ts                  jsonError / readJson / requireUser / handleError / parseId
  *.test.ts               node:test suites

data/arbiter.db           SQLite file (WAL). Runtime state, not source.
public/engine/            Stockfish wasm + glue, loaded as a Worker by same-origin URL
scripts/smoke-test.sh     end-to-end, creates a real 7-player Swiss event
```

---

## Where the data lives

SQLite, `data/arbiter.db`, opened in `lib/db.ts`. There is no ORM and no migration
framework: `SCHEMA` is `CREATE TABLE IF NOT EXISTS` and runs on every open.

| Table | Holds |
| --- | --- |
| `users` | account. `username` display, `username_key` lowercased UNIQUE — uniqueness is enforced on the key, so `Dana` and `dana` collide |
| `sessions` | session tokens, 30 day TTL |
| `tournaments` | slug, name, host, format, `time_control` id, rounds, `status` draft/running/finished |
| `tournament_players` | the field. `user_id` NULL for a typed-in name; `withdrawn` instead of delete once running |
| `games` | one row per board. `fen`, `moves` (JSON), clock columns, `turn_started_at` |
| `pairings` | the draw. `game_id` links to `games`; `is_bye` pairings have no game row |

Two rules that matter:

- **Clock arithmetic is server-authoritative.** The client renders a locally ticking
  estimate but never submits its own elapsed time. `settleClock` in `lib/clock.ts` is
  the only thing that decides a flag.
- **`lib/time-controls.ts` is the only list of time controls.** The host writes an id;
  the server validates against that list and never trusts a duration from the client.

---

## API

All handlers are thin: parse, authorise, call `lib/service.ts`, respond. Errors go
through `handleError`; `requireUser` returns a discriminated result, never a redirect.

```
POST /api/auth/register      409 on a taken username (checked on username_key)
POST /api/auth/login
POST /api/auth/logout
GET  /api/tournaments                       list
POST /api/tournaments                       create (validates the time-control id)
POST /api/tournaments/[slug]/start          draws round 1
POST /api/tournaments/[slug]/advance        draws the next round; refuses while games run
POST /api/tournaments/[slug]/players        add players (draft only)
GET  /api/games/[id]                        state poll, includes serverNow
POST /api/games/[id]/move                   the only way a position changes
POST /api/games/[id]/action                 resign / draw / abort — host only
```

---

## Who may do what

- **Host** (`tournaments.host_id`): add players, start, advance rounds, resign or agree
  draws, abort.
- **Seated player** (`tournament_players.user_id`): move, and only on their own turn.
  The server derives the side to move from the FEN, so nobody can move for the opponent.
- **Everyone else:** read only. Not seated = no dragging, no actions. There is no chat
  and no spectator interaction of any kind, by design.

A host who is not seated is **not** a player. Do not fold host into "seated".

---

## Design system

`app/globals.css` is the whole visual language: tokens, then `@layer components` for
every shared class.

**Every colour is a token, declared twice** — once in `@theme static` (light) and once
in `[data-theme='dark']`. `@theme static` and not plain `@theme`, because Tailwind
tree-shakes theme variables it cannot see being used, and a `var()` inside hand-written
CSS or an inline SVG is invisible to it. `lib/theme.test.ts` fails the build if the two
token sets diverge or a pair drops below its contrast floor — **add tokens to both
blocks or the test fails.**

Themes are switched by the `data-theme` attribute on `<html>`. There is no context and
no provider: an inline script in `app/layout.tsx` sets the attribute before first paint,
`lib/use-theme.ts` subscribes to it with a MutationObserver, and `components/theme-toggle.tsx`
writes it. Anything driven by React state instead of the attribute will flash on load.

House style is **neobrutalist**: hard 2px borders, zero border-radius, offset solid
shadows, no gradients or blur, and colour only where it carries meaning.

Colour is spent in exactly three places: the board (ivory/umber is the subject), the four
status pastels (win/loss/draw/scheduled), and time pressure on the clock. Everything
else is achromatic. That scarcity is what gives the pastels their signal.

---

## Conventions

- TypeScript strict. No `any`; `as unknown as` only where a library's types are wrong.
- Comments explain **why**, never what. If a line needs a comment to say what it does,
  rewrite the line.
- Prefer editing an existing file to adding one. New files go in the folder that owns
  the concept, with the CSS beside the component (`GooeyNav/GooeyNav.css`).
- Tests are `node:test` + `node:assert/strict`, in `lib/*.test.ts`, and must not need a
  DOM, a server, or a network. They cover pure logic and the design system — pieces,
  clocks, pairings, theme tokens, the pre-paint script (executed in a `node:vm`).
- End-to-end behaviour belongs in `scripts/smoke-test.sh`, which drives the real API.

---

## Gotchas

- `lib/clock.ts` deliberately imports nothing. Keep it that way.
- The engine is served from `/public/engine` and instantiated by same-origin URL. It is
  the worker entry point itself; wrapping it in another worker breaks it.
- `react-chessboard` v5 takes a single `options` prop, not flat props.
- One tap reaches the board twice: a finger drifting a few pixels starts and ends a
  drag, then the browser fires a click on the same square. `resolveDrop` (drop on the
  origin square is a tap) and `isTapEcho` in `lib/chess-ui.ts` are the only place that
  is resolved — do not lower `dragActivationDistance`, it is what keeps a tap a tap.
- `GooeyNav` needs ~420px. Below `md` it wraps and its gooey surface balloons over the
  page, which is why `site-header.tsx` swaps it for the drop-down menu there.
- The board colours are read from CSS custom properties in `game-board.tsx`, so the
  board follows the theme. Any hardcoded hex in a board or piece is a bug.
- `MaskedHeading` clips media to letterforms. With no media the heading is invisible,
  which is why the component carries a `data-has-media` fallback that paints the text.
- Deleting a player mid-event would rewrite everyone else's tiebreaks. Withdraw them.
- `advanceRound` refuses while any game is active, so results are always complete before
  a draw is computed.

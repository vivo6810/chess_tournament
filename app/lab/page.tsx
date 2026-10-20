import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import HeroArena from '@/components/hero-arena';
import { ADMIN_HINT_COOKIE } from '@/lib/admin';
import { SESSION_COOKIE, destroySession, getCurrentUser, isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { createTournament, listTournaments, startTournament } from '@/lib/service';
import { TIME_CONTROLS, isTimeControlId } from '@/lib/time-controls';

/**
 * The test lab.
 *
 * A directory that exists to poke the app: start an event in one click, jump to
 * any board by id, see what the database actually holds, and play the engine
 * without loading the landing page. It is admin-only, because half of what it
 * offers is a shortcut around the normal rules (the admin is the host of every
 * tournament, so anything started here can also be settled here).
 *
 * Every action is a server action rather than a client fetch: this page already
 * knows who is signed in, and posting back to the same route keeps the checks in
 * one place.
 */

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Test lab — Arbiter' };

const COUNTED = ['users', 'tournaments', 'tournament_players', 'games', 'pairings'] as const;

type GameRow = {
  id: number;
  status: string;
  result: string | null;
  white_name: string;
  black_name: string;
  updated_at: number;
};

function counts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of COUNTED) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    out[table] = Number(row.n);
  }
  return out;
}

export default async function LabPage() {
  const user = await getCurrentUser();
  /* Not "sign in to see this": a page that explains itself to strangers is a
     page that tells them what to try. To anyone else this route does not exist. */
  if (!isAdmin(user)) notFound();

  const totals = counts();
  const tournaments = listTournaments(6);
  const games = db
    .prepare(
      `SELECT g.id, g.status, g.result, g.updated_at,
              wp.name AS white_name, bp.name AS black_name
       FROM games g
       JOIN tournament_players wp ON wp.id = g.white_player_id
       JOIN tournament_players bp ON bp.id = g.black_player_id
       ORDER BY g.updated_at DESC
       LIMIT 8`,
    )
    .all() as GameRow[];

  /* ── Actions ─────────────────────────────────────────────────── */

  async function scratch(formData: FormData) {
    'use server';
    const current = await getCurrentUser();
    if (!current || !isAdmin(current)) redirect('/');

    const requested = String(formData.get('timeControl') ?? '');
    const timeControlId = isTimeControlId(requested) ? requested : '3+0';
    const names = String(formData.get('players') ?? '')
      .split(/[\n,]/)
      .map((name) => name.trim())
      .filter(Boolean);
    const roster = names.length >= 2 ? names : ['admin', 'Guest'];
    const name = String(formData.get('name') ?? '').trim() || `Lab ${new Date().toISOString().slice(11, 19)}`;

    const created = createTournament({
      hostId: current.id,
      name,
      format: 'swiss',
      timeControlId,
      playerNames: roster,
      totalRounds: 0,
    });

    if (formData.get('start') === 'on') startTournament(created.id);

    revalidatePath('/lab');
    redirect(`/tournaments/${created.slug}`);
  }

  /* Testing means switching accounts, and there is no account menu on the site
     yet. The lab is where the admin is, so it is where leaving is offered. */
  async function signOut() {
    'use server';
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token) destroySession(token);
    store.delete(SESSION_COOKIE);
    store.delete(ADMIN_HINT_COOKIE);
    redirect('/login');
  }

  async function open(formData: FormData) {
    'use server';
    const current = await getCurrentUser();
    if (!current || !isAdmin(current)) redirect('/');

    const id = Number(formData.get('gameId'));
    if (!Number.isInteger(id) || id <= 0) redirect('/lab');
    redirect(`/games/${id}`);
  }

  async function wipe() {
    'use server';
    const current = await getCurrentUser();
    if (!current || !isAdmin(current)) redirect('/');

    /* Tournaments, not accounts: the people who signed up keep their session and
       their username, which is what makes this safe to use while testing. */
    for (const statement of [
      'DELETE FROM pairings',
      'DELETE FROM games',
      'DELETE FROM tournament_players',
      'DELETE FROM tournaments',
    ]) {
      db.prepare(statement).run();
    }

    revalidatePath('/lab');
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16">
      <header className="border-b-2 border-line pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Admin only</p>
          <form action={signOut}>
            <button
              type="submit"
              className="press border-2 border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-ink shadow-brut-sm hover:bg-bone"
            >
              Sign out
            </button>
          </form>
        </div>
        <h1 className="mt-3 text-[clamp(2rem,4vw,2.75rem)] leading-[1.03] font-extrabold tracking-[-0.04em] text-ink">
          Test lab
        </h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">
          A scratch space for poking the app. Signed in as{' '}
          <span className="font-bold text-ink">{user?.username}</span> — host of every tournament,
          which is what lets anything created here be started, settled and cleared from here.
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* ── Scratch tournament ───────────────────────────────── */}
        <section className="border-2 border-line bg-surface shadow-brut">
          <header className="border-b-2 border-line px-5 py-3">
            <h2 className="text-[13px] font-semibold text-ink">Start a scratch event</h2>
            <p className="mt-1 text-[12px] text-muted">
              Creates it and, unless you untick the box, draws round one.
            </p>
          </header>

          <form action={scratch} className="space-y-4 px-5 py-4">
            <label className="block">
              <span className="font-mono text-[11px] tracking-[0.1em] text-muted uppercase">Name</span>
              <input
                name="name"
                placeholder="Lab 12:34:56"
                className="mt-1.5 w-full border-2 border-line-strong bg-canvas px-3 py-2 text-[14px] text-ink"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
                Players, one per line
              </span>
              <textarea
                name="players"
                rows={4}
                defaultValue={'admin\nGuest'}
                className="mt-1.5 w-full border-2 border-line-strong bg-canvas px-3 py-2 font-mono text-[13px] text-ink"
              />
              <span className="mt-1 block text-[11px] text-muted">
                A name that matches a username is that account&rsquo;s seat; anything else is a guest.
              </span>
            </label>

            <label className="block">
              <span className="font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
                Time control
              </span>
              <select
                name="timeControl"
                defaultValue="3+0"
                className="mt-1.5 w-full border-2 border-line-strong bg-canvas px-3 py-2 text-[14px] text-ink"
              >
                {TIME_CONTROLS.map((control) => (
                  <option key={control.id} value={control.id}>
                    {control.label} — {control.category}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" name="start" defaultChecked className="h-4 w-4" />
              Draw round one straight away
            </label>

            <button
              type="submit"
              className="press w-full border-2 border-ink bg-accent px-4 py-2.5 text-[13px] font-bold text-on-accent shadow-brut-sm"
            >
              Create it
            </button>
          </form>
        </section>

        {/* ── Jump ─────────────────────────────────────────────── */}
        <div className="space-y-6">
          <section className="border-2 border-line bg-surface shadow-brut">
            <header className="border-b-2 border-line px-5 py-3">
              <h2 className="text-[13px] font-semibold text-ink">Open a board by id</h2>
            </header>
            <form action={open} className="flex gap-2 px-5 py-4">
              <input
                name="gameId"
                inputMode="numeric"
                placeholder="Game id"
                className="w-full border-2 border-line-strong bg-canvas px-3 py-2 font-mono text-[14px] text-ink"
              />
              <button
                type="submit"
                className="press flex-none border-2 border-ink bg-solid px-4 py-2 text-[13px] font-bold text-on-solid shadow-brut-sm"
              >
                Go
              </button>
            </form>
          </section>

          <section className="border-2 border-line bg-surface shadow-brut">
            <header className="border-b-2 border-line px-5 py-3">
              <h2 className="text-[13px] font-semibold text-ink">What the database holds</h2>
            </header>
            <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
              {COUNTED.map((table) => (
                <div key={table} className="bg-surface px-4 py-3">
                  <dt className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
                    {table.replace('_', ' ')}
                  </dt>
                  <dd className="mt-1 font-mono text-[18px] tabular-nums text-ink">
                    {totals[table]}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="border-2 border-loss-fg bg-loss-bg">
            <header className="border-b-2 border-loss-fg/40 px-5 py-3">
              <h2 className="text-[13px] font-semibold text-loss-fg">Clear the test data</h2>
              <p className="mt-1 text-[12px] text-loss-fg/90">
                Removes every tournament, player seat, game and pairing. Accounts and sessions stay.
              </p>
            </header>
            <form action={wipe} className="px-5 py-4">
              <label className="flex items-center gap-2 text-[13px] text-loss-fg">
                <input type="checkbox" name="confirm" required className="h-4 w-4" />
                I mean it
              </label>
              <button
                type="submit"
                className="press mt-3 w-full border-2 border-loss-fg bg-surface px-4 py-2 text-[13px] font-bold text-loss-fg shadow-brut-sm"
              >
                Delete all tournaments and games
              </button>
            </form>
          </section>
        </div>
      </div>

      {/* ── Recent state ───────────────────────────────────────── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="border-2 border-line bg-surface shadow-brut">
          <header className="flex items-baseline justify-between border-b-2 border-line px-5 py-3">
            <h2 className="text-[13px] font-semibold text-ink">Latest tournaments</h2>
            <Link href="/tournaments" className="text-[12px] text-muted hover:text-ink">
              All →
            </Link>
          </header>
          {tournaments.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted">Nothing yet.</p>
          ) : (
            <ul className="divide-y-2 divide-line">
              {tournaments.map((tournament) => (
                <li key={tournament.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <Link
                    href={`/tournaments/${tournament.slug}`}
                    className="truncate text-[13px] text-ink hover:underline"
                  >
                    {tournament.name}
                  </Link>
                  <span className="flex-none font-mono text-[11px] text-muted">
                    {tournament.status} · {tournament.player_count}p
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border-2 border-line bg-surface shadow-brut">
          <header className="border-b-2 border-line px-5 py-3">
            <h2 className="text-[13px] font-semibold text-ink">Latest boards</h2>
          </header>
          {games.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted">No games yet.</p>
          ) : (
            <ul className="divide-y-2 divide-line">
              {games.map((game) => (
                <li key={game.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <Link href={`/games/${game.id}`} className="truncate text-[13px] text-ink hover:underline">
                    #{game.id} · {game.white_name} — {game.black_name}
                  </Link>
                  <span className="flex-none font-mono text-[11px] text-muted">
                    {game.result ?? game.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── The board, without the landing page ────────────────── */}
      <section className="mt-10">
        <h2 className="text-[12px] font-medium tracking-[0.08em] text-muted uppercase">
          Play the engine
        </h2>
        <div className="mt-4 max-w-xl">
          <HeroArena />
        </div>
      </section>
    </div>
  );
}

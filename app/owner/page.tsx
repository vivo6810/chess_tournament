import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import AccessGate from '@/components/access-gate';
import { ADMIN_HINT_COOKIE, type Role } from '@/lib/admin';
import { SESSION_COOKIE, destroySession, getCurrentUser, isOwner } from '@/lib/auth';
import {
  listAllTournaments,
  listUsers,
  setBlacklisted,
  setRole,
  setSuspended,
} from '@/lib/owner';

/**
 * The owner console.
 *
 * The owner is not a tournament official. It manages the people who use the app
 * — who may sign in, who may act as admin — and it can freeze an event. It
 * cannot decide a game it is not seated in: `canSettleGames` excludes the owner,
 * because "stop the tournament" and "resign someone's game" are different
 * powers, and only the first one belongs here.
 *
 * Like /lab, this route answers 404 rather than a sign-in wall to everyone else.
 */

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Owner console — Arbiter' };

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  user: 'Player',
};

export default async function OwnerPage() {
  const user = await getCurrentUser();
  /* Signed out is not the same as signed in with the wrong role. A stranger who
     followed the nav link gets a way in; anyone with an account that is not the
     owner gets the 404 that keeps the page out of sight. */
  if (!user) return <AccessGate role="owner" next="/owner" />;
  if (!isOwner(user)) notFound();

  const users = listUsers();
  const tournaments = listAllTournaments();
  const admins = users.filter((row) => row.role === 'admin').length;
  const blacklisted = users.filter((row) => row.blacklisted === 1).length;
  const suspended = tournaments.filter((row) => row.suspended === 1).length;

  /* ── Actions ─────────────────────────────────────────────────── */

  async function blacklist(formData: FormData) {
    'use server';
    const current = await getCurrentUser();
    if (!isOwner(current)) notFound();

    const id = Number(formData.get('userId'));
    if (!Number.isInteger(id) || id <= 0) return;
    setBlacklisted(id, formData.get('next') === '1');
    revalidatePath('/owner');
  }

  async function promote(formData: FormData) {
    'use server';
    const current = await getCurrentUser();
    if (!isOwner(current)) notFound();

    const id = Number(formData.get('userId'));
    if (!Number.isInteger(id) || id <= 0) return;
    setRole(id, formData.get('role') === 'admin' ? 'admin' : 'user');
    revalidatePath('/owner');
  }

  async function suspend(formData: FormData) {
    'use server';
    const current = await getCurrentUser();
    if (!isOwner(current)) notFound();

    const id = Number(formData.get('tournamentId'));
    if (!Number.isInteger(id) || id <= 0) return;
    setSuspended(id, formData.get('next') === '1');
    revalidatePath('/owner');
    revalidatePath('/tournaments');
  }

  async function signOut() {
    'use server';
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token) destroySession(token);
    store.delete(SESSION_COOKIE);
    store.delete(ADMIN_HINT_COOKIE);
    redirect('/login');
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16">
      <header className="border-b-2 border-line pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">Owner only</p>
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
          Owner console
        </h1>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-soft">
          Signed in as <span className="font-bold text-ink">{user?.username}</span>. You run the
          people and the events, not the boards: you can suspend a tournament, but an owner never
          settles someone else&rsquo;s game.
        </p>
      </header>

      <dl className="mt-8 grid grid-cols-2 gap-px border-2 border-line bg-line sm:grid-cols-4">
        {[
          { label: 'Accounts', value: users.length },
          { label: 'Admins', value: admins },
          { label: 'Blacklisted', value: blacklisted },
          { label: 'Suspended events', value: suspended },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface px-4 py-3">
            <dt className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
              {stat.label}
            </dt>
            <dd className="mt-1 font-mono text-[20px] tabular-nums text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {/* ── People ───────────────────────────────────────────────── */}
      <section className="mt-8 border-2 border-line bg-surface shadow-brut">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-line px-5 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Every account</h2>
          <p className="text-[12px] text-muted">
            Blacklisting ends the account&rsquo;s sessions immediately.
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-line bg-bone">
                {['Account', 'Role', 'Status', 'Created', 'Controls'].map((heading) => (
                  <th
                    key={heading}
                    className="px-5 py-2 font-mono text-[10px] tracking-[0.12em] text-muted uppercase"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((row) => {
                const isTheOwner = row.role === 'owner';
                return (
                  <tr key={row.id} className="border-b-2 border-line last:border-b-0">
                    <td className="px-5 py-3 text-[13px] font-medium text-ink">
                      {row.username}
                      {row.id === user?.id ? <span className="ml-2 text-[11px] text-muted">(you)</span> : null}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`badge ${
                          row.role === 'owner'
                            ? 'bg-accent text-on-accent'
                            : row.role === 'admin'
                              ? 'bg-info-bg text-info-fg'
                              : 'bg-bone text-muted'
                        }`}
                      >
                        {ROLE_LABEL[row.role]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[12px]">
                      {row.blacklisted === 1 ? (
                        <span className="font-bold text-loss-fg">Blacklisted</span>
                      ) : (
                        <span className="text-muted">Active</span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] text-muted">
                      {new Date(row.created_at).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-5 py-3">
                      {isTheOwner ? (
                        <span className="text-[12px] text-muted">The owner is fixed.</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={promote}>
                            <input type="hidden" name="userId" value={row.id} />
                            <input
                              type="hidden"
                              name="role"
                              value={row.role === 'admin' ? 'user' : 'admin'}
                            />
                            <button
                              type="submit"
                              className="press border-2 border-line-strong bg-surface px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-bone"
                            >
                              {row.role === 'admin' ? 'Remove admin' : 'Make admin'}
                            </button>
                          </form>
                          <form action={blacklist}>
                            <input type="hidden" name="userId" value={row.id} />
                            <input type="hidden" name="next" value={row.blacklisted === 1 ? '0' : '1'} />
                            <button
                              type="submit"
                              className="press border-2 border-line-strong bg-surface px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-bone"
                            >
                              {row.blacklisted === 1 ? 'Restore' : 'Blacklist'}
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Events ───────────────────────────────────────────────── */}
      <section className="mt-8 border-2 border-line bg-surface shadow-brut">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-line px-5 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Every tournament</h2>
          <p className="text-[12px] text-muted">Suspending freezes moves, results and new rounds.</p>
        </header>

        {tournaments.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted">Nothing yet.</p>
        ) : (
          <ul className="divide-y-2 divide-line">
            {tournaments.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/tournaments/${row.slug}`}
                    className="block truncate text-[13px] font-medium text-ink hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="font-mono text-[11px] text-muted">
                    {row.status} · host {row.host_name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {row.suspended === 1 ? (
                    <span className="badge bg-loss-bg text-loss-fg">Suspended</span>
                  ) : null}
                  <form action={suspend}>
                    <input type="hidden" name="tournamentId" value={row.id} />
                    <input type="hidden" name="next" value={row.suspended === 1 ? '0' : '1'} />
                    <button
                      type="submit"
                      className="press border-2 border-line-strong bg-surface px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-bone"
                    >
                      {row.suspended === 1 ? 'Restore' : 'Suspend'}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

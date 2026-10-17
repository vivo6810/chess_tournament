import Link from 'next/link';

import NewTournamentForm from '@/components/new-tournament-form';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Host a tournament — Arbiter' };

export default async function NewTournamentPage() {
  const user = await getCurrentUser();

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <header className="mb-12 max-w-2xl">
        <span className="badge bg-info-bg text-info-fg">Host</span>
        <h1 className="mt-4 text-[clamp(2rem,4vw,2.75rem)] leading-[1.02] font-extrabold tracking-[-0.04em] text-ink">
          Set the field. The draw runs itself.
        </h1>
      </header>

      {user ? (
        <NewTournamentForm />
      ) : (
        <div className="max-w-md rounded-none border-2 border-line bg-surface shadow-brut px-6 py-7">
          <p className="text-[15px] font-bold text-ink">You need an account to host.</p>
          <div className="mt-5 flex gap-3">
            <Link
              href="/register"
              className="press rounded-none bg-accent px-4 py-2.5 text-[13px] font-medium text-on-accent transition-colors hover:bg-accent/90"
            >
              Create an account
            </Link>
            <Link
              href="/login"
              className="press rounded-none border-2 border-line-strong px-4 py-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-bone"
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

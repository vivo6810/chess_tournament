import Link from 'next/link';

/**
 * The sign-in wall in front of a restricted route.
 *
 * `/owner` and `/lab` hide themselves from signed-in people whose role does not
 * match, because a page that explains what it offers is a page that tells
 * strangers what to try. A signed-out visitor is different: they may well be the
 * person the page belongs to, and a bare 404 leaves them with no way forward.
 *
 * The gate keeps the role out of the copy where it can: it says who the page is
 * for without listing what it does.
 */

const COPY = {
  owner: {
    eyebrow: 'Owner only',
    title: 'This console needs the owner account.',
    body: 'It belongs to the person who runs the deployment, not to a tournament host.',
  },
  admin: {
    eyebrow: 'Staff only',
    title: 'The test lab needs a staff account.',
    body: 'It belongs to the admin account that runs events and settles boards.',
  },
} as const;

export default function AccessGate({
  role,
  next,
}: {
  role: keyof typeof COPY;
  next: string;
}) {
  const copy = COPY[role];

  return (
    <div className="mx-auto flex max-w-6xl justify-center px-6 py-20 sm:py-24">
      <div className="w-full max-w-md border-2 border-line bg-surface px-6 py-7 shadow-brut">
        <span className="badge bg-bone text-muted">{copy.eyebrow}</span>

        <h1 className="mt-4 text-[26px] leading-[1.08] font-extrabold tracking-[-0.03em] text-ink">
          {copy.title}
        </h1>

        <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">{copy.body}</p>

        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Sign in and you land back here. If you were already signed in, the session did not
          reach this server — signing in again is still the way through.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="press border-2 border-ink bg-accent px-4 py-2.5 text-[13px] font-bold text-on-accent shadow-brut-sm"
          >
            Sign in
          </Link>
          <Link
            href="/"
            className="press border-2 border-line-strong bg-surface px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-bone"
          >
            Back to the board
          </Link>
        </div>
      </div>
    </div>
  );
}

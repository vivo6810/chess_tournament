import AuthForm from '@/components/auth-form';

export const metadata = { title: 'Sign in — Arbiter' };

/**
 * `next` is where a restricted page sends someone who is signed out — see
 * `components/access-gate.tsx`. It is only honoured as a path on this site, so a
 * crafted link cannot turn the sign-in form into an open redirect.
 */
function safeNext(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const next = safeNext((await searchParams).next);

  return (
    <div className="mx-auto flex max-w-6xl justify-center px-6 py-24">
      <AuthForm mode="login" next={next} />
    </div>
  );
}

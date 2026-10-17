'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/auth/${isRegister ? 'register' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Something went wrong.' }));
      setError(payload.error ?? 'Something went wrong.');
      setBusy(false);
      return;
    }

    router.push('/tournaments/new');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="w-full max-w-sm">
      <h1 className="font-extrabold text-[30px] leading-[1.15] tracking-[-0.03em] text-ink">
        {isRegister ? 'Create an account' : 'Sign in'}
      </h1>
      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
            Username
          </span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            className="mt-1.5 w-full rounded-none border-2 border-line-strong bg-surface px-3 py-2.5 text-[14px] text-ink outline-none transition-colors focus:border-ink"
            placeholder="dana_whitfield"
          />
        </label>

        <label className="block">
          <span className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
            className="mt-1.5 w-full rounded-none border-2 border-line-strong bg-surface px-3 py-2.5 text-[14px] text-ink outline-none transition-colors focus:border-ink"
            placeholder={isRegister ? 'at least 8 characters' : ''}
          />
        </label>
      </div>

      {error ? (
        <p className="mt-4 rounded-none border-2 border-loss-bg bg-loss-bg px-3 py-2 text-[13px] text-loss-fg">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="press mt-6 w-full rounded-none bg-accent px-5 py-3 text-[14px] font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:opacity-50"
      >
        {busy ? 'Working…' : isRegister ? 'Create account' : 'Sign in'}
      </button>

      <p className="mt-5 text-[13px] text-muted">
        {isRegister ? 'Already have an account? ' : 'No account yet? '}
        <Link href={isRegister ? '/login' : '/register'} className="text-ink underline underline-offset-2">
          {isRegister ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </form>
  );
}

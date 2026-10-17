import AuthForm from '@/components/auth-form';

export const metadata = { title: 'Sign in — Arbiter' };

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-6xl justify-center px-6 py-24">
      <AuthForm mode="login" />
    </div>
  );
}

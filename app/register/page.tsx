import AuthForm from '@/components/auth-form';

export const metadata = { title: 'Create an account — Arbiter' };

export default function RegisterPage() {
  return (
    <div className="mx-auto flex max-w-6xl justify-center px-6 py-24">
      <AuthForm mode="register" />
    </div>
  );
}

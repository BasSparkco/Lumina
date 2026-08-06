'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';

const DEMO_ACCOUNTS = [
  { labelKey: 'demoOwner' as const, email: 'admin@demo.com', password: 'changeme' },
  { labelKey: 'demoViewer' as const, email: 'viewer@demo.com', password: 'changeme' },
];

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('auth.login');
  const tc = useTranslations('common');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(`/${locale}/dashboard`);
  }, [user, loading, router, locale]);

  async function handleSubmit() {
    if (!email || !password || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      router.push(`/${locale}/dashboard`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('loginFailed'));
      // Keep the email — the backend intentionally returns the same error
      // whether the email or password was wrong, so we can't (and shouldn't)
      // guess which one to blame; only clear the password for re-entry.
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEnter(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void handleSubmit();
  }

  function fillDemo(demoEmail: string, demoPassword: string) {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError('');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('title')}</h1>
        {/* Not a native <form>: a real submit event fires (and can trigger the
            browser's save-password prompt) before our JS knows login failed. */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('email')}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleEnter}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('password')}</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleEnter}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 pe-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                title={showPassword ? tc('hidePassword') : tc('showPassword')}
                className="absolute inset-y-0 end-0 flex items-center px-2.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting || !email || !password}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? t('signingIn') : t('signIn')}
          </button>
        </div>
        <p className="mt-4 text-sm text-center text-gray-500 dark:text-gray-400">
          {t('noAccount')}{' '}
          <a href={`/${locale}/register`} className="text-indigo-600 hover:underline">{t('createOne')}</a>
        </p>
        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mb-2">{t('demoAccounts')}</p>
          <div className="space-y-1.5">
            {DEMO_ACCOUNTS.map(acc => (
              <button key={acc.email} type="button" onClick={() => fillDemo(acc.email, acc.password)}
                className="w-full flex items-center justify-between gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <span className="font-medium text-gray-600 dark:text-gray-300">{t(acc.labelKey)}</span>
                <span className="text-gray-400 dark:text-gray-500 truncate">{acc.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

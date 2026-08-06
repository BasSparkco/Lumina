'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('auth.register');
  const tc = useTranslations('common');
  const [form, setForm] = useState({ orgName: '', email: '', password: '', name: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function handleSubmit() {
    if (!form.orgName || !form.email || !form.password || !form.name || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await register(form.orgName, form.email, form.password, form.name);
      router.push(`/${locale}/dashboard`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('registrationFailed'));
      setForm(f => ({ ...f, password: '' }));
    } finally {
      setSubmitting(false);
    }
  }

  function handleEnter(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void handleSubmit();
  }

  const field = (label: string, key: keyof typeof form, type = 'text') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input type={type} value={form[key]} onChange={set(key)} onKeyDown={handleEnter}
        className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('title')}</h1>
        {/* Not a native <form>: a real submit event fires (and can trigger the
            browser's save-password prompt) before our JS knows the request failed. */}
        <div className="space-y-4">
          {field(t('orgName'), 'orgName')}
          {field(t('yourName'), 'name')}
          {field(t('email'), 'email', 'email')}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('password')}</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')} onKeyDown={handleEnter}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 pe-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                title={showPassword ? tc('hidePassword') : tc('showPassword')}
                className="absolute inset-y-0 end-0 flex items-center px-2.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="button" onClick={() => void handleSubmit()}
            disabled={submitting || !form.orgName || !form.email || !form.password || !form.name}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? t('creatingAccount') : t('createAccount')}
          </button>
        </div>
        <p className="mt-4 text-sm text-center text-gray-500 dark:text-gray-400">
          {t('haveAccount')}{' '}
          <a href={`/${locale}/login`} className="text-indigo-600 hover:underline">{t('signIn')}</a>
        </p>
      </div>
    </div>
  );
}

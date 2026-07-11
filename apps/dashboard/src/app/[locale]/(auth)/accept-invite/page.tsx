'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { membersApi } from '@/lib/mocks/members';

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow p-8">{children}</div>
    </div>
  );
}

function AcceptInviteForm() {
  const token = useSearchParams().get('token') ?? '';
  const locale = useLocale();
  const t = useTranslations('auth.acceptInvite');
  const tc = useTranslations('common');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const inviteQuery = useQuery({
    queryKey: ['invite', token],
    queryFn: () => membersApi.getInvite(token),
    enabled: !!token,
    retry: false,
  });

  const acceptMut = useMutation({
    mutationFn: () => membersApi.acceptInvite(token, name.trim()),
    onError: () => setPassword(''),
  });

  if (!token) {
    return <Card><p className="text-sm text-red-600">{t('missingToken')}</p></Card>;
  }

  if (inviteQuery.isLoading) {
    return <Card><p className="text-sm text-gray-400">{t('checkingInvite')}</p></Card>;
  }

  if (inviteQuery.isError) {
    return <Card><p className="text-sm text-red-600">{inviteQuery.error.message}</p></Card>;
  }

  if (acceptMut.isSuccess) {
    return (
      <Card>
        <div className="text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{t('welcomeTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('welcomeBody')}</p>
          <a href={`/${locale}/login`}
            className="block w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            {t('goToSignIn')}
          </a>
        </div>
      </Card>
    );
  }

  const invite = inviteQuery.data!;

  function handleSubmit() {
    if (!name.trim() || password.length < 8 || acceptMut.isPending) return;
    acceptMut.mutate();
  }

  function handleEnter(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }

  return (
    <Card>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{t('joinOrg', { org: invite.orgName })}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        {t('invitedAs', { role: tc(`roles.${invite.role}`), email: invite.email })}
      </p>
      {/* Not a native <form>: a real submit event fires (and can trigger the
          browser's save-password prompt) before our JS knows the request failed. */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('yourName')}</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} onKeyDown={handleEnter}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('choosePassword')}</label>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} minLength={8} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleEnter}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 pe-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
              title={showPassword ? tc('hidePassword') : tc('showPassword')}
              className="absolute inset-y-0 end-0 flex items-center px-2.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {acceptMut.isError && <p className="text-sm text-red-600">{acceptMut.error.message}</p>}
        <button type="button" onClick={handleSubmit} disabled={acceptMut.isPending || !name.trim() || password.length < 8}
          className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {acceptMut.isPending ? t('joining') : t('acceptInvite')}
        </button>
      </div>
    </Card>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<Card><p className="text-sm text-gray-400">Loading…</p></Card>}>
      <AcceptInviteForm />
    </Suspense>
  );
}

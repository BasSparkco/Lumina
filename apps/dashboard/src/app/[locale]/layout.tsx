import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { AuthProvider } from '@/context/AuthContext';
import { QueryProvider } from '@/context/QueryProvider';
import { LocaleAttributes } from './LocaleAttributes';

interface Props {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

// Nested under the true root (app/layout.tsx) — does NOT render <html>/<body>.
// Everything here legitimately depends on the locale param, so it's fine for
// this layer to remount on a language switch; what matters is that <html>/
// <body>/ThemeProvider (in the root layout) no longer do.
export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as 'en' | 'ar')) notFound();
  const messages = await getMessages();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <NextIntlClientProvider messages={messages}>
      <LocaleAttributes locale={locale} dir={dir} />
      <QueryProvider>
        <AuthProvider>{children}</AuthProvider>
      </QueryProvider>
    </NextIntlClientProvider>
  );
}

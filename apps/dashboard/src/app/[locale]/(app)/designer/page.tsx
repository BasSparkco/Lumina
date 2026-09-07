'use client';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LayoutTemplate, Palette } from 'lucide-react';
import { LayoutsSection } from './LayoutsSection';

// Themes pulls in the full 43-font @fontsource bundle as a side effect (see fontImports.ts)
// purely for its own canvas/FontPicker — deferring it to a dynamic import keeps that bundle out
// of the initial page chunk for anyone who lands here to edit a layout instead.
const ThemesSection = dynamic(() => import('./ThemesSection').then(m => m.ThemesSection), { ssr: false });

// The Designer page is purely the canvas editor — for one layout or theme at a time, addressed
// by `?type=layout|theme&id=…` (or no id, for a new one). Browsing/managing existing layouts and
// themes lives on the Templates page; its cards and "New" buttons link in here.
function DesignerPageInner() {
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations('designer');
  const type = searchParams.get('type');
  const id = searchParams.get('id') ?? 'new';
  const preset = searchParams.get('preset') ?? undefined;

  if (type === 'layout') return <LayoutsSection mode="edit" targetId={id} />;
  if (type === 'theme') return <ThemesSection mode="edit" targetId={id} presetId={preset} />;

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold text-[var(--deck-text-hi)]">{t('title')}</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--deck-text-mid)]">{t('subtitle')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`/${locale}/designer?type=layout`}
          className="flex flex-col items-start gap-2 rounded-xl border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] p-5 text-start hover:border-[var(--deck-accent)] hover:bg-[var(--deck-accent-soft)]/50"
        >
          <LayoutTemplate className="h-5 w-5 text-[var(--deck-accent)]" />
          <span className="font-medium text-[var(--deck-text-hi)]">{t('newLayout')}</span>
          <span className="text-xs text-[var(--deck-text-mid)]">{t('newLayoutHint')}</span>
        </Link>
        <Link
          href={`/${locale}/designer?type=theme`}
          className="flex flex-col items-start gap-2 rounded-xl border border-[var(--deck-glass-border)] bg-[var(--deck-glass-fill-strong)] p-5 text-start hover:border-[var(--deck-accent)] hover:bg-[var(--deck-accent-soft)]/50"
        >
          <Palette className="h-5 w-5 text-[var(--deck-accent)]" />
          <span className="font-medium text-[var(--deck-text-hi)]">{t('newTheme')}</span>
          <span className="text-xs text-[var(--deck-text-mid)]">{t('newThemeHint')}</span>
        </Link>
      </div>
    </div>
  );
}

export default function DesignerPage() {
  return (
    <Suspense fallback={null}>
      <DesignerPageInner />
    </Suspense>
  );
}

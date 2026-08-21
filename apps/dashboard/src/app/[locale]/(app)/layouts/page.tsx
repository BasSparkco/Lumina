'use client';
import { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { LayoutsSection } from './LayoutsSection';

// Layouts is the default tab and never renders arbitrary-font text (see LayoutsSection — no
// fontStack usage), so it stays a static import. ThemesSection pulls in the full 43-font
// @fontsource bundle as a side effect (see fontImports.ts) purely for its own canvas/FontPicker
// — deferring it to a dynamic import means that bundle now only loads for someone who actually
// opens the Themes tab, instead of on every visit to /layouts.
const ThemesSection = dynamic(() => import('./ThemesSection').then(m => m.ThemesSection), { ssr: false });

type Tab = 'layouts' | 'themes';

function LayoutsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'themes' ? 'themes' : 'layouts');

  function selectTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    router.replace(next === 'themes' ? `${pathname}?tab=themes` : pathname, { scroll: false });
  }

  return tab === 'layouts'
    ? <LayoutsSection onSelectTab={selectTab} />
    : <ThemesSection onSelectTab={selectTab} />;
}

export default function LayoutsPage() {
  return (
    <Suspense fallback={null}>
      <LayoutsPageInner />
    </Suspense>
  );
}

'use client';
import { Suspense, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { LayoutsSection } from '../designer/LayoutsSection';

// Themes pulls in the full 43-font @fontsource bundle as a side effect (see fontImports.ts)
// purely for its own canvas/FontPicker — deferring it to a dynamic import keeps that bundle out
// of the initial page chunk.
const ThemesSection = dynamic(() => import('../designer/ThemesSection').then(m => m.ThemesSection), { ssr: false });

// Browsable library of every existing layout and theme — creating or editing one happens on the
// Designer page (see designer/page.tsx); this page only lists, searches, renames, duplicates and
// deletes them.
function TemplatesPageInner() {
  const searchParams = useSearchParams();
  // Deep-link convenience for links built before Themes was its own section (the legacy /themes
  // bookmark redirect) — scrolls to the Themes section instead of switching to it.
  const themesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (searchParams.get('tab') === 'themes') {
      themesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams]);

  return (
    <div>
      <LayoutsSection mode="list" />
      <div ref={themesRef}>
        <ThemesSection mode="list" />
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={null}>
      <TemplatesPageInner />
    </Suspense>
  );
}

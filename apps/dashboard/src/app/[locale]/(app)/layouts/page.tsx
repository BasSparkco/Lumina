'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';

// Layouts was renamed to Templates — this route only exists to keep old bookmarks/links working,
// same pattern as the /themes redirect below it.
function LayoutsRedirectPageInner() {
  const router = useRouter();
  const locale = useLocale();
  const searchParams = useSearchParams();
  useEffect(() => {
    const tab = searchParams.get('tab');
    router.replace(`/${locale}/templates${tab ? `?tab=${tab}` : ''}`);
  }, [router, locale, searchParams]);
  return null;
}

export default function LayoutsRedirectPage() {
  return (
    <Suspense fallback={null}>
      <LayoutsRedirectPageInner />
    </Suspense>
  );
}

'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';

// Themes was merged into the Templates page as a section — this route only exists to keep old
// bookmarks/links working.
export default function ThemesRedirectPage() {
  const router = useRouter();
  const locale = useLocale();
  useEffect(() => {
    router.replace(`/${locale}/templates?tab=themes`);
  }, [router, locale]);
  return null;
}

'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useAuth } from '@/context/AuthContext';

/** Redirects away from a route the current role isn't allowed to access — defense in
 * depth on top of the backend's own enforcement, and a step further than the
 * per-action disabling used on content pages (Assets/Playlists/etc. stay visible in
 * read-only form for viewers; a handful of routes like Members are admin-only and
 * should never render at all for anyone else).
 *
 * Waits for the initial auth check to finish before redirecting: `user` is briefly
 * null on a hard refresh while `AuthContext` calls `/auth/me`, which would otherwise
 * make a real ADMIN/OWNER's role look like the VIEWER default and bounce them.
 * Returns whether the page is clear to render its real content yet. */
export function useRouteGuard(allowed: boolean, redirectTo = 'screens'): boolean {
  const { loading } = useAuth();
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    if (!loading && !allowed) router.replace(`/${locale}/${redirectTo}`);
  }, [loading, allowed, router, locale, redirectTo]);

  return !loading && allowed;
}

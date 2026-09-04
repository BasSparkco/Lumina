'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import type { ModuleKey } from '@lumina/types';
import { useAuth } from '@/context/AuthContext';
import { useModuleAccess } from './useModuleAccess';

/** Module-aware sibling of useRouteGuard() — redirects away from a module's management page
 * for a tenant that doesn't own it. Separate from the role-oriented guard because entitlement
 * and role are different axes (see docs/adr/platform-modules-and-entitlements.md); a page that
 * needs both calls both hooks.
 *
 * Waits for both the initial auth check *and* capabilities to load before redirecting or
 * rendering — the same reasoning useRouteGuard() already applies to auth alone, extended to
 * capabilities so a real licensed tenant's still-loading capabilities don't look like "no
 * module" and bounce them. The API remains the actual security boundary; this only prevents a
 * flash of protected UI and the noisy 403 requests that would otherwise fire immediately. */
export function useModuleRouteGuard(moduleKey: ModuleKey, redirectTo = 'screens'): boolean {
  const { loading: authLoading } = useAuth();
  const { allowed, loading: capsLoading } = useModuleAccess(moduleKey);
  const router = useRouter();
  const locale = useLocale();
  const loading = authLoading || capsLoading;

  useEffect(() => {
    if (!loading && !allowed) router.replace(`/${locale}/${redirectTo}`);
  }, [loading, allowed, router, locale, redirectTo]);

  return !loading && allowed;
}

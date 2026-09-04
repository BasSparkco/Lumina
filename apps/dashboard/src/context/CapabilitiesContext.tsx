'use client';
import { createContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ModuleKey, TenantCapabilities } from '@lumina/types';
import { orgApi } from '@/lib/api';
import { useAuth } from './AuthContext';

export interface CapabilitiesCtx {
  capabilities: TenantCapabilities | null;
  isLoading: boolean;
  error: Error | null;
  hasModule: (key: ModuleKey) => boolean;
}

export const CapabilitiesContext = createContext<CapabilitiesCtx | null>(null);

// Single fetch of GET /org/capabilities per authenticated session — every consumer goes through
// useCapabilities()/useModuleAccess() rather than calling orgApi.getCapabilities() itself, so
// there's exactly one place that knows how to decide "is this module usable." Deliberately not
// merged into usePermissions(): tenant module ownership and user role are different axes (see
// docs/adr/platform-modules-and-entitlements.md).
export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // react-query dedupes concurrent callers of this same queryKey on its own — no extra work
  // needed here for that requirement.
  const { data, isLoading, error } = useQuery({
    queryKey: ['org', 'capabilities'],
    queryFn: orgApi.getCapabilities,
    enabled: !!user,
  });

  // Mirrors EntitlementsService's own usability rule (org ACTIVE; module ACTIVE, or TRIAL and
  // not expired) so the nav/route guard hides exactly what the API would also reject — but this
  // is a UI convenience only, not the security boundary; the API always re-checks for real (see
  // Section 3.3 of the ADR). Deliberately doesn't walk MODULE_DEPENDENCIES here — nothing in the
  // dashboard today gates a dependent module's own nav entry, only WAYFINDING itself.
  const hasModule = useMemo(() => {
    return (key: ModuleKey): boolean => {
      if (!data || data.tenantStatus !== 'ACTIVE') return false;
      const mod = data.modules.find((m) => m.key === key);
      if (!mod) return false;
      if (mod.status === 'ACTIVE') return true;
      if (mod.status === 'TRIAL') return !mod.expiresAt || new Date(mod.expiresAt) > new Date();
      return false;
    };
  }, [data]);

  const value = useMemo<CapabilitiesCtx>(
    () => ({ capabilities: data ?? null, isLoading, error: error as Error | null, hasModule }),
    [data, isLoading, error, hasModule],
  );

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

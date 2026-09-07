import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRouteGuard } from '../useRouteGuard';
import { useModuleRouteGuard } from '../useModuleRouteGuard';

// P9 (docs/tenant_isolation_and_platform_admin_plan.md §P9 required suite #8) — the dashboard's
// two direct-route guards (useRouteGuard for role-gated pages like Members, useModuleRouteGuard
// for module-gated pages like Wayfinding/Room Booking). Both hooks are explicitly documented as
// defense in depth, not the real security boundary (the API enforces the actual check) — what
// these tests verify is the client-side behavior contract those doc comments describe: never
// redirect while still loading (a real ADMIN must not get bounced mid-refresh because `user` is
// briefly null), redirect once loading finishes and access is denied, and never redirect an
// allowed user.

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));

const useAuthMock = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuth: () => useAuthMock() }));

const useModuleAccessMock = vi.fn();
vi.mock('@/hooks/useModuleAccess', () => ({ useModuleAccess: (key: string) => useModuleAccessMock(key) }));

beforeEach(() => {
  replace.mockClear();
  useAuthMock.mockReset();
  useModuleAccessMock.mockReset();
});

describe('useRouteGuard', () => {
  it('does not redirect while auth is still loading, and reports not-yet-clear', () => {
    useAuthMock.mockReturnValue({ loading: true });
    const { result } = renderHook(() => useRouteGuard(false));
    expect(result.current).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects once loading finishes and the role is not allowed', () => {
    useAuthMock.mockReturnValue({ loading: false });
    const { result } = renderHook(() => useRouteGuard(false, 'screens'));
    expect(result.current).toBe(false);
    expect(replace).toHaveBeenCalledWith('/en/screens');
  });

  it('never redirects an allowed role, and reports clear to render', () => {
    useAuthMock.mockReturnValue({ loading: false });
    const { result } = renderHook(() => useRouteGuard(true));
    expect(result.current).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('useModuleRouteGuard', () => {
  it('waits for both auth AND capabilities to finish loading before redirecting', () => {
    useAuthMock.mockReturnValue({ loading: false });
    useModuleAccessMock.mockReturnValue({ allowed: false, loading: true });
    const { result } = renderHook(() => useModuleRouteGuard('WAYFINDING'));
    expect(result.current).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects a tenant without the module once both finish loading", () => {
    useAuthMock.mockReturnValue({ loading: false });
    useModuleAccessMock.mockReturnValue({ allowed: false, loading: false });
    const { result } = renderHook(() => useModuleRouteGuard('WAYFINDING', 'screens'));
    expect(result.current).toBe(false);
    expect(replace).toHaveBeenCalledWith('/en/screens');
  });

  it('never redirects a tenant that has the module', () => {
    useAuthMock.mockReturnValue({ loading: false });
    useModuleAccessMock.mockReturnValue({ allowed: true, loading: false });
    const { result } = renderHook(() => useModuleRouteGuard('ROOM_BOOKING'));
    expect(result.current).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '../AuthContext';
import type * as ApiModule from '@/lib/api';

// P9 (docs/tenant_isolation_and_platform_admin_plan.md §P9 required suite #8, "Dashboard tests
// for cache clearing... "; see also docs/adr/tenant-isolation-and-shared-content.md §Dashboard
// identity and cache boundary, P2) — the property under test is the one that ADR section exists
// to guarantee: react-query's cache is fully cleared on login/register/logout, so a component can
// never render a frame holding a *previous* identity's cached data (members, assets, playlists,
// ...) under a new one — the concrete risk being Tenant A's cached data flashing under Tenant B
// after switching accounts in the same browser tab without a full page reload.
//
// Asserts via a spy on queryClient.clear(), not by polling getQueryData() back to undefined — an
// active query observer (any real page still mounted through the transition) refetches and can
// repopulate the same key within milliseconds of clear(), which is correct real-world behavior
// but makes "eventually empty" a race, not a meaningful assertion. What actually matters, and
// what the ADR commits to, is that clear() runs before the new identity is set.

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('@/lib/api');
  return {
    ...actual,
    authApi: {
      login: vi.fn().mockResolvedValue({ token: 'new-token', user: { id: 'u2', email: 'b@x.com', name: 'B', role: 'OWNER', orgId: 'org-b', isSuperAdmin: false } }),
      register: vi.fn().mockResolvedValue({ token: 'new-token', user: { id: 'u3', email: 'c@x.com', name: 'C', role: 'OWNER', orgId: 'org-c', isSuperAdmin: false } }),
      me: vi.fn().mockRejectedValue(new Error('no token')),
    },
    getToken: vi.fn().mockReturnValue(null),
    setToken: vi.fn(),
    clearToken: vi.fn(),
  };
});

function LoginProbe() {
  const { login, user } = useAuth();
  return (
    <div>
      <span data-testid="user">{user?.email ?? 'none'}</span>
      <button onClick={() => { void login('b@x.com', 'pw'); }}>login</button>
    </div>
  );
}

function LogoutProbe() {
  const { logout } = useAuth();
  return <button onClick={logout}>logout</button>;
}

describe('AuthContext cache boundary', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal('location', { ...window.location, replace: vi.fn(), pathname: '/en/screens' });
  });

  it('clears react-query cache on login, before the new user is set', async () => {
    const clearSpy = vi.spyOn(queryClient, 'clear');
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(clearSpy).not.toHaveBeenCalled();
    await user.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('b@x.com'));
    expect(cancelSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('clears react-query cache on logout', async () => {
    const clearSpy = vi.spyOn(queryClient, 'clear');
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LogoutProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByText('logout'));
    expect(clearSpy).toHaveBeenCalled();
  });
});

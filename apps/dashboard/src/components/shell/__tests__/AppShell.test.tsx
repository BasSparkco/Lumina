import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as NextIntl from 'next-intl';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../AppShell';
import {
  EditorDirtyProvider,
  useEditorDirty,
} from '@/context/EditorDirtyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { useAppSidebar } from '@/context/AppSidebarContext';
import en from '../../../../messages/en.json';
import ar from '../../../../messages/ar.json';
import type { User } from '@/lib/api';

const state = vi.hoisted(() => ({
  pathname: '/en/screens',
  locale: 'en',
  loading: false,
  capsLoading: false,
  user: {
    id: 'fixture-user',
    orgId: 'fixture-org',
    name: 'Test Admin',
    email: 'admin@example.test',
    role: 'ADMIN',
    isSuperAdmin: false,
  } as User | null,
  push: vi.fn(),
  replace: vi.fn(),
  logout: vi.fn(),
  hasModule: vi.fn(() => false),
  query: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: state.push, replace: state.replace }),
}));
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof NextIntl>();
  return { ...actual, useLocale: () => state.locale };
});
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: state.user,
    loading: state.loading,
    logout: state.logout,
  }),
}));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({
    hasModule: state.hasModule,
    isLoading: state.capsLoading,
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => {
    state.query(options);
    return { data: [{ approvalStatus: 'PENDING' }] };
  },
}));
vi.mock('@/lib/api', () => ({ playlistsApi: { list: vi.fn() } }));

function Content({ dirty = false }: { dirty?: boolean }) {
  const { setDirty } = useEditorDirty();
  const sidebar = useAppSidebar();
  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);
  return (
    <>
      <p>Existing page content</p>
      <button onClick={() => sidebar?.setOpen(true)}>
        Editor menu trigger
      </button>
    </>
  );
}
function renderShell(dirty = false) {
  return render(
    <NextIntlClientProvider
      locale={state.locale}
      messages={state.locale === 'ar' ? ar : en}
      timeZone="UTC"
    >
      <ThemeProvider>
        <EditorDirtyProvider>
          <AppShell>
            <Content dirty={dirty} />
          </AppShell>
        </EditorDirtyProvider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  state.pathname = '/en/screens';
  state.locale = 'en';
  state.loading = false;
  state.capsLoading = false;
  state.user = {
    id: 'fixture-user',
    orgId: 'fixture-org',
    name: 'Test Admin',
    email: 'admin@example.test',
    role: 'ADMIN',
    isSuperAdmin: false,
  };
  state.hasModule.mockReturnValue(false);
  window.history.replaceState(null, '', '/en/screens');
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe('Signal application shell', () => {
  it('preserves the auth loading boundary and disables approval fetching without an identity', () => {
    state.user = null;
    state.loading = true;
    renderShell();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('Existing page content')).not.toBeInTheDocument();
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.query).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('redirects unauthenticated users using their locale', async () => {
    state.user = null;
    state.locale = 'ar';
    state.pathname = '/ar/screens';
    renderShell();
    await waitFor(() =>
      expect(state.replace).toHaveBeenCalledWith('/ar/login'),
    );
  });

  it('keeps a single active link and separates platform navigation', () => {
    state.pathname = '/en/admin/templates';
    state.user!.isSuperAdmin = true;
    renderShell();
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Design Templates' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Templates' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(
      screen.queryByRole('link', { name: 'Billing' }),
    ).not.toBeInTheDocument();
  });

  it('honors unsaved changes for navigation, language changes and sign out', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderShell(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Media library' }));
    await user.click(screen.getByRole('button', { name: 'Switch to Arabic' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(state.push).not.toHaveBeenCalled();
    expect(state.logout).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('preserves query and anchor on language switching and uses the existing theme state', async () => {
    window.history.replaceState(null, '', '/en/screens?group=fixture#details');
    renderShell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Switch to Arabic' }));
    expect(state.push).toHaveBeenCalledWith(
      '/ar/screens?group=fixture#details',
    );
    await user.click(screen.getByRole('button', { name: 'Use dark mode' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('lumina_theme')).toBe('dark');
  });

  it('localizes the actual shell and does not show unavailable modules', () => {
    state.locale = 'ar';
    state.pathname = '/ar/screens';
    state.capsLoading = true;
    state.hasModule.mockReturnValue(true);
    renderShell();
    expect(screen.getByRole('link', { name: 'الشاشات' })).toHaveAttribute(
      'href',
      '/ar/screens',
    );
    expect(document.querySelector('.signal-shell')).toHaveAttribute(
      'dir',
      'rtl',
    );
    expect(
      screen.queryByRole('link', { name: 'الإرشاد' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'الإرشاد الذكي' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'حجز الغرف' }),
    ).not.toBeInTheDocument();
  });

  it('retains Designer2 full-height content, drawer context and Escape close', async () => {
    state.pathname = '/en/designer2';
    renderShell();
    expect(
      document.querySelector('.signal-management'),
    ).not.toBeInTheDocument();
    expect(document.querySelector('.signal-header')).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Editor menu trigger' }));
    expect(document.querySelector('.signal-sidebar')).toHaveClass('is-open');
    fireEvent.keyDown(document.querySelector('.signal-sidebar')!, {
      key: 'Escape',
    });
    expect(document.querySelector('.signal-sidebar')).not.toHaveClass(
      'is-open',
    );
  });
});

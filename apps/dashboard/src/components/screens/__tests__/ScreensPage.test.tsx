import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Screen, UserRole } from '@/lib/api';
import ScreensPage from '@/app/[locale]/(app)/screens/page';
import en from '../../../../messages/en.json';

const fixtures = vi.hoisted(() => ({
  role: 'ADMIN' as UserRole,
  fail: false,
  statuses: {} as Record<string, 'ONLINE' | 'OFFLINE'>,
  publish: vi.fn(async () => ({})),
  pair: vi.fn(async () => ({})),
  screens: [] as Screen[],
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { role: fixtures.role, isSuperAdmin: false },
    loading: false,
  }),
}));
vi.mock('@/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ allowed: false, loading: false }),
}));
vi.mock('@/hooks/useFaithFeatures', () => ({
  useFaithFeatures: () => ({ enabled: false }),
}));
vi.mock('@/hooks/useScreenSocket', () => ({
  useScreenSocket: () => ({
    statuses: fixtures.statuses,
    playbackProgress: {},
  }),
}));
vi.mock('@/lib/api', () => ({
  screensApi: {
    list: async () => { if (fixtures.fail) throw new Error('Unavailable'); return fixtures.screens; },
    publish: fixtures.publish,
    pair: fixtures.pair,
  },
  playlistsApi: {
    list: async () => [{ id: 'playlist-1', name: 'Welcome loop' }],
  },
  assetsApi: { list: async () => [] },
  screenGroupsApi: { list: async () => [] },
  orgApi: { getSettings: async () => ({ autoPublish: false }) },
  themesApi: {},
  wayfindingApi: {},
  roomBookingApi: {},
  QUICK_BOOKING_DURATIONS_MINUTES: [15, 30, 60],
}));

function fixture(id: string, name: string, status: Screen['status']): Screen {
  return {
    id,
    name,
    status,
    lastSeenAt: '2026-09-08T08:00:00Z',
    paired: true,
    streamingType: 'PLAYLIST',
    assetId: null,
    playlistId: 'playlist-1',
    emergencyActive: false,
    stopped: false,
    showClock: false,
    latitude: null,
    longitude: null,
    prayerMethod: 'UmmAlQura',
    athanEnabled: false,
    timezone: 'UTC',
    timezoneEnabled: false,
    screenshotUrl: null,
    screenshotUpdatedAt: null,
    hasContent: true,
    volume: null,
    orientation: 0,
    aspectRatio: '16:9',
    groupId: null,
    kioskLocation: null,
  };
}
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <ScreensPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fixtures.role = 'ADMIN';
  fixtures.fail = false;
  fixtures.statuses = {};
  fixtures.screens = [
    fixture('screen-a', 'Reception', 'ONLINE'),
    fixture('screen-b', 'Café', 'OFFLINE'),
  ];
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});

describe('Screens migration preserves operational behavior', () => {
  it('focuses the pairing code and then the new screen name without an extra click', async () => {
    fixtures.pair.mockResolvedValueOnce(fixture('screen-new', 'Unnamed Screen', 'OFFLINE'));
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: en.screens.pairScreen }));
    const code = screen.getByRole('textbox', { name: en.screens.overview.pairingCode });
    expect(code).toHaveFocus();
    await user.type(code, 'abc123');
    await user.click(screen.getByRole('button', { name: en.screens.pair }));
    await screen.findByRole('dialog', { name: en.screens.nameWarning.title });
    expect(screen.getByPlaceholderText(en.screens.nameWarning.placeholder)).toHaveFocus();
    expect(fixtures.pair).toHaveBeenCalledWith('ABC123');
  });

  it('shows a load failure instead of claiming the fleet is empty', async () => {
    fixtures.fail = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(en.screens.overview.loadFailed);
    expect(screen.queryByText(en.screens.empty)).not.toBeInTheDocument();
  });
  it('uses live status over the initial snapshot and combines status/search filters', async () => {
    fixtures.statuses = { 'screen-b': 'ONLINE', 'screen-a': 'OFFLINE' };
    renderPage();
    await screen.findByRole('button', { name: 'Manage Reception' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Connection'), 'OFFLINE');
    expect(
      screen.getByRole('button', { name: 'Manage Reception' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Manage Café' }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: en.common.search }),
      'Café',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(en.common.noMatches)).toBeInTheDocument();
  });

  it('opens the unchanged control card and sends publish to the selected screen only', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Manage Reception' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Reception' });
    expect(within(dialog).getByText('Welcome loop')).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: en.screens.publish }),
    );
    await waitFor(() =>
      expect(fixtures.publish).toHaveBeenCalledWith('screen-a'),
    );
    expect(fixtures.publish).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Manage Reception' }),
    ).toHaveFocus();
  });

  it('allows a viewer to inspect details without exposing edit/publish/pair actions', async () => {
    fixtures.role = 'VIEWER';
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Manage Reception' }),
    );
    expect(
      screen.queryByRole('button', { name: en.screens.pairScreen }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: en.screens.publish }),
    ).not.toBeInTheDocument();
    expect(fixtures.publish).not.toHaveBeenCalled();
  });

  it('offers overview reordering only for the complete editable fleet', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Manage Reception' });
    expect(screen.getAllByRole('button', { name: en.screens.dragToReorder })).toHaveLength(2);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Connection'), 'OFFLINE');
    expect(screen.queryByRole('button', { name: en.screens.dragToReorder })).not.toBeInTheDocument();
  });

  it('retains control view and disables reordering while a status filter is active', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Manage Reception' });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Controls' }),
    );
    expect(
      screen.getAllByRole('button', { name: en.screens.dragToReorder }),
    ).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText('Connection'), 'OFFLINE');
    expect(
      screen.queryByRole('button', { name: en.screens.dragToReorder }),
    ).not.toBeInTheDocument();
  });
});

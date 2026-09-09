import type * as Api from '@/lib/api';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlaylistSettingsModal } from '../PlaylistSettingsModal';
import en from '../../../messages/en.json';
const update = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof Api>(),
  playlistsApi: {
    get: async () => ({ scaleSettings: {}, transitionStyle: 'NONE', transitionDurationMs: 500, playbackOrder: 'SEQUENTIAL' }),
    updateConfig: update,
  },
}));
beforeEach(() => {
  update.mockClear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
function show(canEdit: boolean) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NextIntlClientProvider locale="en" messages={en}>
      <PlaylistSettingsModal id="playlist-review" name="Welcome loop" canEdit={canEdit} onClose={vi.fn()} />
    </NextIntlClientProvider>
  </QueryClientProvider>);
}
it('labels settings and preserves the exact scale update payload', async () => {
  show(true);
  expect(screen.getByRole('dialog')).toHaveAccessibleName(/Welcome loop/);
  const image = await screen.findByLabelText(en.playlistSettings.scaleSettings.types.IMAGE);
  await userEvent.selectOptions(image, 'cover');
  await waitFor(() => expect(update).toHaveBeenCalledWith('playlist-review', { scaleSettings: { IMAGE: 'cover' } }));
});
it('keeps playback configuration read-only for viewers', async () => {
  show(false);
  await screen.findByLabelText(en.playlistSettings.scaleSettings.types.IMAGE);
  for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
  expect(update).not.toHaveBeenCalled();
});

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlankDesignDocument } from '@lumina/design-schema';
import { assetsApi, type Asset } from '@/lib/api';
import en from '../../../../../messages/en.json';
import ar from '../../../../../messages/ar.json';
import { DesignerShell } from '../DesignerShell';
import { useDesignerStore } from '../../state/designer.store';

vi.mock('@/lib/api', () => ({ assetsApi: { list: vi.fn(), get: vi.fn(), upload: vi.fn(), touch: vi.fn(async () => {}) } }));
vi.mock('../../hooks/useAutosave', () => ({ useAutosave: () => 'idle', clearLocalDraft: vi.fn() }));
vi.mock('@/hooks/useConfirmBeforeDelete', () => ({ useConfirmBeforeDelete: () => ({ confirmDelete: () => true }) }));
vi.mock('../CanvasViewport', () => ({ CanvasViewport: () => null }));
vi.mock('../InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('../SceneStrip', () => ({ SceneStrip: () => null }));
vi.mock('../VersionsPanel', () => ({ VersionsPanel: () => null }));
vi.mock('../DesignerTopBar', () => ({ DesignerTopBar: ({ onUndo }: { onUndo: () => void }) => <button onClick={onUndo}>Undo</button> }));

const media = { id: 'landscape', name: 'Landscape', type: 'IMAGE', status: 'READY', width: 1200, height: 600,
  url: 'https://example.test/image.png', thumbnailUrl: null, createdAt: '2026-09-01', lastUsedAt: null } as Asset;
let queryClient: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  const image = document.createElement('img');
  Object.defineProperties(image, {
    naturalWidth: { value: 1200 }, naturalHeight: { value: 600 },
    src: { set() { queueMicrotask(() => image.dispatchEvent(new Event('load'))); } },
  });
  vi.spyOn(globalThis, 'Image').mockImplementation(function () { return image; } as unknown as typeof Image);

  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  useDesignerStore.getState().loadDocument(buildBlankDesignDocument('Test'));
  vi.mocked(assetsApi.list).mockResolvedValue([media]);
  vi.mocked(assetsApi.get).mockResolvedValue(media);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });
function mount(locale: 'en' | 'ar' = 'en') {
  render(<NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : ar}>
    <QueryClientProvider client={queryClient}><DesignerShell /></QueryClientProvider>
  </NextIntlClientProvider>);
  return userEvent.setup();
}
const elements = () => useDesignerStore.getState().document!.scenes[0]!.elements;

describe('Designer2 media insertion workflow', () => {
  it('creates no placeholder, inserts one ready asset, and undoes the insertion in one step', async () => {
    const user = mount();
    await user.click(screen.getByRole('button', { name: 'Images' }));
    expect(elements()).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: 'Choose media' }));
    await user.click(screen.getByRole('button', { name: /Landscape/ }));
    await waitFor(() => expect(elements()).toHaveLength(1));
    expect(elements()[0]).toMatchObject({ assetId: media.id, width: 1200, height: 600, fit: 'contain' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(elements()).toHaveLength(0);
  });

  it.each(['cancel', 'scene switch'] as const)('does not insert a late upload after %s', async (action) => {
    let finish!: (asset: Asset) => void;
    vi.mocked(assetsApi.upload).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const user = mount();
    await user.click(screen.getByRole('button', { name: 'Images' }));
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await user.upload(screen.getByLabelText('Choose a file'), new File(['image'], 'test.png', { type: 'image/png' }));
    const signal = vi.mocked(assetsApi.upload).mock.calls[0]![2]!;
    if (action === 'cancel') await user.click(screen.getByRole('button', { name: 'Cancel' }));
    else await act(async () => {
      const scene = useDesignerStore.getState().document!.scenes[0]!;
      useDesignerStore.getState().addScene({ ...scene, id: 'second' });
    });
    expect(signal.aborted).toBe(true);
    await act(async () => finish(media));
    expect(useDesignerStore.getState().document!.scenes.every((scene) => scene.elements.length === 0)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uploads a portrait video before inserting it', async () => {
    const video = { ...media, id: 'portrait', type: 'VIDEO', width: 600, height: 1200 } as Asset;
    vi.mocked(assetsApi.upload).mockResolvedValue({ ...video, status: 'PROCESSING' });
    vi.mocked(assetsApi.get).mockResolvedValue(video);
    const user = mount();
    await user.click(screen.getByRole('button', { name: 'Video' }));
    expect(elements()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await user.upload(screen.getByLabelText('Choose a file'), new File(['video'], 'test.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(elements()).toHaveLength(1));
    expect(elements()[0]!.width / elements()[0]!.height).toBe(0.5);
    expect(elements()[0]).toMatchObject({ type: 'video', assetId: 'portrait', fit: 'contain' });
    expect(queryClient.getQueryData<Asset[]>(['assets'])?.some((asset) => asset.id === 'portrait')).toBe(true);
  });

  it('presents the new media choices in Arabic with RTL direction', async () => {
    const user = mount('ar');
    await user.click(screen.getByRole('button', { name: 'صور' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'رفع ملف' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'اختيار من الأصول' })).toBeVisible();
  });
});

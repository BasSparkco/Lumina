import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi, type Asset } from '@/lib/api';
import { createMediaElement } from '../defaultElements';
import { prepareMedia, probeMediaDimensions, type MediaKind } from '../mediaInsertion';

vi.mock('@/lib/api', () => ({ assetsApi: { get: vi.fn() } }));
const asset = (patch: Partial<Asset> = {}): Asset => ({
  id: 'asset', name: 'Media', type: 'IMAGE', status: 'READY', url: 'https://example.test/media',
  width: 1200, height: 600, ...patch,
} as Asset);
beforeEach(() => {
  const image = document.createElement('img');
  Object.defineProperties(image, {
    naturalWidth: { value: 1200 }, naturalHeight: { value: 600 },
    src: { set() { queueMicrotask(() => image.dispatchEvent(new Event('load'))); } },
  });
  vi.spyOn(globalThis, 'Image').mockImplementation(function () { return image; } as unknown as typeof Image);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('direct media preparation and geometry', () => {
  it.each<[MediaKind, number, number]>([
    ['IMAGE', 1200, 600], ['IMAGE', 600, 1200], ['VIDEO', 1920, 1080], ['VIDEO', 1080, 1920],
  ])('inserts %s %i×%i with natural aspect ratio and one complete asset reference', (kind, width, height) => {
    const media = { asset: asset({ type: kind }), width, height };
    const element = createMediaElement({ width: 800, height: 600 }, [], media);
    expect(element.width / element.height).toBeCloseTo(width / height);
    expect(element.width).toBeLessThanOrEqual(640);
    expect(element.height).toBeLessThanOrEqual(480);
    expect(element.x + element.width / 2).toBe(400);
    expect(element.y + element.height / 2).toBe(300);
    expect(element).toMatchObject({ type: kind.toLowerCase(), assetId: 'asset', fit: 'contain' });
    expect(element).not.toHaveProperty('url');
  });

  it('does not upscale small media and centers in the visible portion of the scene', () => {
    const element = createMediaElement({ width: 1920, height: 1080 }, [],
      { asset: asset(), width: 100, height: 50 }, { x: 500, y: 300, width: 400, height: 300 });
    expect(element).toMatchObject({ width: 100, height: 50, x: 650, y: 425 });
  });

  it('waits for ready normalized metadata before returning', async () => {
    vi.useFakeTimers();
    vi.mocked(assetsApi.get).mockResolvedValueOnce(asset({ status: 'PROCESSING' })).mockResolvedValueOnce(asset());
    const pending = prepareMedia('asset', 'IMAGE', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ width: 1200, height: 600 });
    expect(assetsApi.get).toHaveBeenCalledTimes(2);
  });

  it('stops polling when cancelled', async () => {
    vi.useFakeTimers();
    vi.mocked(assetsApi.get).mockResolvedValue(asset({ status: 'PROCESSING' }));
    const controller = new AbortController();
    const pending = prepareMedia('asset', 'IMAGE', controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([['FAILED', 'IMAGE', 'failed'], ['READY', 'VIDEO', 'wrongType']] as const)('rejects %s / %s', async (status, type, code) => {
    vi.mocked(assetsApi.get).mockResolvedValue(asset({ status, type }));
    await expect(prepareMedia('asset', 'IMAGE', new AbortController().signal)).rejects.toMatchObject({ code });
  });

  it('probes missing image metadata and removes its source after reading it', async () => {
    const img = document.createElement('img');
    Object.defineProperties(img, { naturalWidth: { value: 300 }, naturalHeight: { value: 900 } });
    vi.spyOn(globalThis, 'Image').mockImplementation(function () { return img; } as unknown as typeof Image);
    vi.mocked(assetsApi.get).mockResolvedValue(asset({ width: null, height: null }));
    const pending = prepareMedia('asset', 'IMAGE', new AbortController().signal);
    await Promise.resolve();
    img.dispatchEvent(new Event('load'));
    expect(await pending).toMatchObject({ width: 300, height: 900 });
    expect(img.hasAttribute('src')).toBe(false);
  });

  it('cleans up a cancelled video metadata probe', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const controller = new AbortController();
    const pending = probeMediaDimensions('https://example.test/video', 'VIDEO', controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
  });

  it('uses displayed image dimensions when encoded metadata has a different orientation', async () => {
    const img = document.createElement('img');
    Object.defineProperties(img, { naturalWidth: { value: 600 }, naturalHeight: { value: 1200 } });
    vi.spyOn(globalThis, 'Image').mockImplementation(function () { return img; } as unknown as typeof Image);
    vi.mocked(assetsApi.get).mockResolvedValue(asset({ width: 1200, height: 600 }));
    const pending = prepareMedia('asset', 'IMAGE', new AbortController().signal);
    await Promise.resolve();
    img.dispatchEvent(new Event('load'));
    expect(await pending).toMatchObject({ width: 600, height: 1200 });
  });

  it('reports a bounded processing timeout', async () => {
    vi.useFakeTimers();
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    vi.mocked(assetsApi.get).mockResolvedValue(asset({ status: 'PROCESSING' }));
    const pending = prepareMedia('asset', 'IMAGE', new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1);
    timeout.abort();
    await rejected;
  });

  it('times out an unavailable metadata probe and clears its source', async () => {
    vi.useFakeTimers();
    const img = document.createElement('img');
    vi.spyOn(globalThis, 'Image').mockImplementation(function () { return img; } as unknown as typeof Image);
    const pending = probeMediaDimensions('https://example.test/missing', 'IMAGE', new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'dimensions' });
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(img.hasAttribute('src')).toBe(false);
  });
});

import { assetsApi, type Asset } from '@/lib/api';

export type MediaKind = 'IMAGE' | 'VIDEO';
export type ReadyMedia = { asset: Asset; width: number; height: number };
export type MediaErrorCode = 'failed' | 'timeout' | 'dimensions' | 'wrongType';
export class MediaInsertionError extends Error {
  constructor(public code: MediaErrorCode) { super(code); }
}

function validDimensions(width: number | null, height: number | null): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && (width ?? 0) > 0 && (height ?? 0) > 0;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function probeMediaDimensions(url: string, kind: MediaKind, signal: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const media = kind === 'IMAGE' ? new Image() : document.createElement('video');
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      media.onload = media.onerror = null;
      if (media instanceof HTMLVideoElement) {
        media.onloadedmetadata = null;
        media.removeAttribute('src');
        media.load();
      } else media.removeAttribute('src');
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => fail(signal.reason);
    const ready = () => {
      const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
      const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
      if (!validDimensions(width, height)) { fail(new MediaInsertionError('dimensions')); return; }
      cleanup();
      resolve({ width, height });
    };
    const timer = setTimeout(() => fail(new MediaInsertionError('dimensions')), 15000);
    signal.addEventListener('abort', abort, { once: true });
    media.onerror = () => fail(new MediaInsertionError('dimensions'));
    if (media instanceof HTMLVideoElement) {
      media.preload = 'metadata';
      media.muted = true;
      media.onloadedmetadata = ready;
    } else {
      media.crossOrigin = 'anonymous';
      media.onload = ready;
    }
    media.src = url;
  });
}

// The existing upload pipeline may return PROCESSING. Bound both polling and individual
// requests; cancellation never creates a design element or installs a stale asset selection.
export async function prepareMedia(id: string, kind: MediaKind, signal: AbortSignal): Promise<ReadyMedia> {
  const timeout = AbortSignal.timeout(120000);
  const requestSignal = AbortSignal.any([signal, timeout]);
  try {
    for (;;) {
      requestSignal.throwIfAborted();
      const asset = await assetsApi.get(id, requestSignal);
      if (asset.type !== kind) throw new MediaInsertionError('wrongType');
      if (asset.status === 'FAILED' || asset.status === 'ERROR') throw new MediaInsertionError('failed');
      if (asset.status === 'READY') {
        if (!asset.url) throw new MediaInsertionError('failed');
        // Video metadata is taken from the normalized transcode. Image metadata currently
        // describes the original encoded file, so use browser dimensions to honor EXIF rotation.
        const dimensions = kind === 'VIDEO' && validDimensions(asset.width, asset.height)
          ? { width: asset.width!, height: asset.height! }
          : await probeMediaDimensions(asset.url, kind, requestSignal);
        requestSignal.throwIfAborted();
        return { asset, ...dimensions };
      }
      await delay(2000, requestSignal);
    }
  } catch (error) {
    if (timeout.aborted && !signal.aborted) throw new MediaInsertionError('timeout');
    throw error;
  }
}

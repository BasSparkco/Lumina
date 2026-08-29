import type { MediaAssetDescriptor } from '../media-storage/types';

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, description: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${description} timed out`)), timeoutMs);
    operation.then(
      value => { clearTimeout(timer); resolve(value); },
      error => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function probeImage(uri: string, timeoutMs: number): Promise<void> {
  const image = new Image();
  image.decoding = 'async';
  image.src = uri;
  try {
    await withTimeout(
      typeof image.decode === 'function'
        ? image.decode()
        : new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('Image decoder rejected the media'));
        }),
      timeoutMs,
      'Image readability probe',
    );
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error('Image has no decodable dimensions');
  } finally {
    image.src = '';
  }
}

async function probeTimedMedia(type: 'audio' | 'video', uri: string, timeoutMs: number): Promise<void> {
  const media = document.createElement(type);
  media.preload = 'metadata';
  media.muted = true;
  const operation = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      media.removeEventListener('loadedmetadata', onLoaded);
      media.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      if (!Number.isFinite(media.duration) || media.duration <= 0) {
        reject(new Error(`${type} has no finite playable duration`));
      } else {
        resolve();
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${type} decoder rejected the media (code ${media.error?.code ?? 'unknown'})`));
    };
    media.addEventListener('loadedmetadata', onLoaded, { once: true });
    media.addEventListener('error', onError, { once: true });
    media.src = uri;
    media.load();
  });
  try {
    await withTimeout(operation, timeoutMs, `${type} readability probe`);
  } finally {
    media.removeAttribute('src');
    media.load();
  }
}

export async function probeMediaReadability(
  asset: MediaAssetDescriptor,
  uri: string,
  timeoutMs = 15_000,
): Promise<void> {
  if (asset.type === 'image' || asset.type === 'document-page') return probeImage(uri, timeoutMs);
  if (asset.type === 'video' || asset.type === 'audio') return probeTimedMedia(asset.type, uri, timeoutMs);
}

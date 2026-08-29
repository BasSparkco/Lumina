/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare let self: ServiceWorkerGlobalScope;

// Injected by vite-plugin-pwa's injectManifest build step — precaches the app shell
// (JS/CSS/HTML/icons) exactly like the old generateSW config did.
precacheAndRoute(self.__WB_MANIFEST);

const MEDIA_CACHE = 'media-cache';
const MEDIA_METADATA_CACHE = 'media-cache-metadata-v1';
const MAX_ENTRIES = 200;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days, same as the old declarative config
const METADATA_TOUCH_INTERVAL_MS = 60_000;

const IMAGE_PATTERN = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;
const VIDEO_PATTERN = /\.(mp4|webm)(\?.*)?$/i;

// Cache Storage only exposes completed responses. Keep track of a full-file download while it
// is in progress so a preload fetch and several <video> range requests don't each download the
// same large file independently.
const videoCacheFills = new Map<string, Promise<Response>>();
const lastMetadataTouches = new Map<string, number>();

interface VideoCacheMetadata {
  url: string;
  cachedAt: number;
  lastUsedAt: number;
  sizeBytes: number;
}

function logMediaCache(event: string, details: Record<string, unknown>) {
  console.info('[lumina-media-cache]', { event, ...details });
}

// Images: <img> tags don't send Range requests, so a plain CacheFirst works exactly as
// intended — this half of the old config was never actually broken.
registerRoute(
  ({ url }) => IMAGE_PATTERN.test(url.pathname) && !url.searchParams.has('__lumina_media_sync'),
  new CacheFirst({
    cacheName: MEDIA_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: MAX_ENTRIES, maxAgeSeconds: MAX_AGE_SECONDS }),
    ],
  }),
);

// Video needs custom handling, not the declarative CacheFirst strategy above. A <video>
// element's request always carries a `Range` header; the origin (apps/api's MediaController)
// correctly answers with 206 Partial Content; and Workbox's default cacheable-response check
// only stores status-200 (or opaque 0) responses. A CacheFirst route would therefore see a
// 206 on every single fetch, silently refuse to cache it, and fall through to the network
// every time — which is exactly why video was never actually served from local cache and
// every playback (including every loop of the same clip) re-downloaded from scratch.
//
// Fix: always populate the cache with ONE full, range-header-free fetch of the asset — one
// cache entry per URL, keyed without the incoming Range header — then synthesize whatever
// byte-range response the <video> element actually asked for out of that single full copy.
// Subsequent requests for the same asset (replays, playlist loops, the next screen's fetch of
// the same asset) are served entirely from Cache Storage with zero network round-trips.
function handleVideoRequest({ request, event }: { request: Request; event: ExtendableEvent }): Promise<Response> {
  // waitUntil's first call must happen while the fetch event is still being dispatched. Register
  // the complete cache/miss workflow synchronously here instead of trying to call waitUntil after
  // an awaited caches.open()/cache.match(), which some WebViews reject with InvalidStateError.
  const response = resolveVideoRequest(request);
  event.waitUntil(response.then(() => undefined));
  return response;
}

async function resolveVideoRequest(request: Request): Promise<Response> {
  const cache = await caches.open(MEDIA_CACHE);
  const cacheKey = new Request(request.url); // no Range header — one entry per asset

  const full = await cache.match(cacheKey);

  if (full) {
    await touchVideoCacheEntry(cacheKey.url, full);
    logMediaCache('hit', { url: cacheKey.url, range: request.headers.get('range') });
    if (!request.headers.has('range')) return full;
    return createStreamingRangeResponse(request, full);
  }

  logMediaCache('miss', { url: cacheKey.url, range: request.headers.get('range') });
  const fill = fillVideoCache(cache, cacheKey);
  // Do not also stream the incoming Range request from the origin: that old behavior downloaded
  // the same file twice (one 200 cache fill plus one 206 playback request).
  const cached = await fill;
  if (!cached.ok || cached.status !== 200 || !request.headers.has('range')) return cached;
  return createStreamingRangeResponse(request, cached);
}

function fillVideoCache(cache: Cache, cacheKey: Request): Promise<Response> {
  const existing = videoCacheFills.get(cacheKey.url);
  if (existing) {
    logMediaCache('download-joined', { url: cacheKey.url });
    return existing.then(response => response.clone());
  }

  const fill = (async () => {
    const startedAt = Date.now();
    logMediaCache('download-start', { url: cacheKey.url });
    try {
      const networkResponse = await fetch(cacheKey, { mode: 'cors', credentials: 'omit' });
      if (!networkResponse.ok || networkResponse.status !== 200) {
        logMediaCache('download-failed', {
          url: cacheKey.url,
          status: networkResponse.status,
          durationMs: Date.now() - startedAt,
        });
        return networkResponse;
      }

      // Cache.put consumes this response directly. Avoid response.clone() here: teeing a large body
      // while one branch waits unused can retain a substantial amount of video data in memory.
      const sizeBytes = Number(networkResponse.headers.get('content-length') ?? 0);
      await cache.put(cacheKey, networkResponse);
      await writeVideoCacheMetadata({
        url: cacheKey.url,
        cachedAt: Date.now(),
        lastUsedAt: Date.now(),
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      });
      await trimVideoCache();
      const cached = await cache.match(cacheKey);
      if (!cached) throw new Error(`Video cache entry disappeared after write: ${cacheKey.url}`);
      logMediaCache('download-complete', {
        url: cacheKey.url,
        sizeBytes,
        durationMs: Date.now() - startedAt,
      });
      return cached;
    } catch (error) {
      logMediaCache('download-failed', {
        url: cacheKey.url,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  })();

  videoCacheFills.set(cacheKey.url, fill);
  void fill.then(
    () => { videoCacheFills.delete(cacheKey.url); },
    () => { videoCacheFills.delete(cacheKey.url); },
  );
  return fill;
}

registerRoute(
  ({ url }) => VIDEO_PATTERN.test(url.pathname) && !url.searchParams.has('__lumina_media_sync'),
  handleVideoRequest,
);

function videoMetadataKey(url: string): Request {
  const key = new URL('/__lumina_media_metadata__', self.location.origin);
  key.searchParams.set('url', url);
  return new Request(key.href);
}

async function readVideoCacheMetadata(url: string): Promise<VideoCacheMetadata | null> {
  const metadataCache = await caches.open(MEDIA_METADATA_CACHE);
  const response = await metadataCache.match(videoMetadataKey(url));
  if (!response) return null;
  try {
    return await response.json() as VideoCacheMetadata;
  } catch {
    return null;
  }
}

async function writeVideoCacheMetadata(metadata: VideoCacheMetadata): Promise<void> {
  const metadataCache = await caches.open(MEDIA_METADATA_CACHE);
  await metadataCache.put(
    videoMetadataKey(metadata.url),
    new Response(JSON.stringify(metadata), { headers: { 'Content-Type': 'application/json' } }),
  );
}

async function deleteVideoCacheMetadata(url: string): Promise<void> {
  const metadataCache = await caches.open(MEDIA_METADATA_CACHE);
  await metadataCache.delete(videoMetadataKey(url));
  lastMetadataTouches.delete(url);
}

async function touchVideoCacheEntry(url: string, response: Response): Promise<void> {
  const now = Date.now();
  if (now - (lastMetadataTouches.get(url) ?? 0) < METADATA_TOUCH_INTERVAL_MS) return;
  lastMetadataTouches.set(url, now);
  const existing = await readVideoCacheMetadata(url);
  const sizeBytes = Number(response.headers.get('content-length') ?? existing?.sizeBytes ?? 0);
  await writeVideoCacheMetadata({
    url,
    cachedAt: existing?.cachedAt ?? now,
    lastUsedAt: now,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
  });
}

// Streams only the requested byte interval from the disk-backed cached response. Workbox's
// createPartialResponse() calls response.blob(), materializing the complete MP4 for every range;
// that causes large memory spikes and loop-time stalls on signage hardware.
function createStreamingRangeResponse(request: Request, full: Response): Response {
  const rangeHeader = request.headers.get('range');
  const totalSize = Number(full.headers.get('content-length'));
  if (!rangeHeader || !Number.isSafeInteger(totalSize) || totalSize <= 0 || !full.body) {
    return rangeNotSatisfiable(totalSize);
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) return rangeNotSatisfiable(totalSize);

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return rangeNotSatisfiable(totalSize);
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : totalSize - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= totalSize || end < start) {
    return rangeNotSatisfiable(totalSize);
  }
  end = Math.min(end, totalSize - 1);

  const reader = full.body.getReader();
  let sourceOffset = 0;
  let remaining = end - start + 1;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (remaining > 0) {
        const { done, value } = await reader.read();
        if (done || !value) {
          controller.error(new Error('Cached video ended before the requested range was complete'));
          return;
        }
        const chunkStart = sourceOffset;
        const chunkEnd = chunkStart + value.byteLength;
        sourceOffset = chunkEnd;
        if (chunkEnd <= start) continue;

        const sliceStart = Math.max(0, start - chunkStart);
        const sliceLength = Math.min(value.byteLength - sliceStart, remaining);
        controller.enqueue(value.subarray(sliceStart, sliceStart + sliceLength));
        remaining -= sliceLength;
        if (remaining === 0) {
          await reader.cancel();
          controller.close();
        }
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  const headers = new Headers(full.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
  return new Response(body, { status: 206, statusText: 'Partial Content', headers });
}

function rangeNotSatisfiable(totalSize: number): Response {
  const headers = new Headers();
  if (Number.isSafeInteger(totalSize) && totalSize > 0) headers.set('Content-Range', `bytes */${totalSize}`);
  return new Response(null, { status: 416, statusText: 'Range Not Satisfiable', headers });
}

// Explicit metadata avoids the production bug where a cross-origin Date header was unavailable,
// timestamp zero was assumed, and a brand-new video was immediately deleted as "older than 7d".
async function trimVideoCache() {
  const cache = await caches.open(MEDIA_CACHE);
  const keys = (await cache.keys()).filter(key => VIDEO_PATTERN.test(new URL(key.url).pathname));
  const cutoff = Date.now() - MAX_AGE_SECONDS * 1000;
  const records = await Promise.all(
    keys.map(async key => {
      const metadata = await readVideoCacheMetadata(key.url);
      return { key, metadata };
    }),
  );
  const stale = records.filter(record => record.metadata !== null && record.metadata.lastUsedAt < cutoff);
  await Promise.all(stale.map(async ({ key }) => {
    await cache.delete(key);
    await deleteVideoCacheMetadata(key.url);
    logMediaCache('evicted', { url: key.url, reason: 'max-age' });
  }));

  const remaining = records
    .filter(record => !stale.includes(record))
    .sort((a, b) => (a.metadata?.lastUsedAt ?? Date.now()) - (b.metadata?.lastUsedAt ?? Date.now()));
  const overflow = remaining.length - MAX_ENTRIES;
  if (overflow > 0) {
    await Promise.all(remaining.slice(0, overflow).map(async ({ key }) => {
      await cache.delete(key);
      await deleteVideoCacheMetadata(key.url);
      logMediaCache('evicted', { url: key.url, reason: 'max-entries' });
    }));
  }
}

self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// PlayerPage.tsx's existing 'clear-cache' command already enumerates and deletes every
// Cache Storage entry directly (caches.keys() / caches.delete(key)) from the page itself, so
// MEDIA_CACHE is dropped by that flow with no extra wiring needed here.

/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { createPartialResponse } from 'workbox-range-requests';

declare let self: ServiceWorkerGlobalScope;

// Injected by vite-plugin-pwa's injectManifest build step — precaches the app shell
// (JS/CSS/HTML/icons) exactly like the old generateSW config did.
precacheAndRoute(self.__WB_MANIFEST);

const MEDIA_CACHE = 'media-cache';
const MAX_ENTRIES = 200;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days, same as the old declarative config

const IMAGE_PATTERN = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;
const VIDEO_PATTERN = /\.(mp4|webm)(\?.*)?$/i;

// Images: <img> tags don't send Range requests, so a plain CacheFirst works exactly as
// intended — this half of the old config was never actually broken.
registerRoute(
  ({ url }) => IMAGE_PATTERN.test(url.pathname),
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
async function handleVideoRequest({ request }: { request: Request }): Promise<Response> {
  const cache = await caches.open(MEDIA_CACHE);
  const cacheKey = new Request(request.url); // no Range header — one entry per asset

  let full = await cache.match(cacheKey);
  if (!full) {
    const networkResponse = await fetch(cacheKey, { mode: 'cors', credentials: 'omit' });
    if (!networkResponse.ok) return networkResponse;
    await cache.put(cacheKey, networkResponse.clone());
    full = networkResponse;
    void trimMediaCache();
  }

  if (!request.headers.has('range')) return full;
  return createPartialResponse(request, full);
}

registerRoute(({ url }) => VIDEO_PATTERN.test(url.pathname), handleVideoRequest);

// createPartialResponse reads the cached entry's full body on every range slice, so an
// unbounded media-cache would both blow disk quota and make every subsequent seek slower to
// serve. Mirrors the old declarative config's maxEntries/maxAgeSeconds (200 entries / 7 days),
// applied manually since ExpirationPlugin only attaches to a declarative Strategy, not a
// hand-written handler.
async function trimMediaCache() {
  const cache = await caches.open(MEDIA_CACHE);
  const keys = await cache.keys();
  const cutoff = Date.now() - MAX_AGE_SECONDS * 1000;
  const stale = await Promise.all(
    keys.map(async key => {
      const res = await cache.match(key);
      const dateHeader = res?.headers.get('date');
      const age = dateHeader ? new Date(dateHeader).getTime() : 0;
      return age < cutoff ? key : null;
    }),
  );
  await Promise.all(stale.filter((k): k is Request => k !== null).map(k => cache.delete(k)));

  const remaining = await cache.keys();
  const overflow = remaining.length - MAX_ENTRIES;
  if (overflow > 0) {
    await Promise.all(remaining.slice(0, overflow).map(k => cache.delete(k)));
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

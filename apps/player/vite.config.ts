import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Switched from `generateSW` (a purely declarative runtimeCaching config) to
      // `injectManifest`, which lets src/sw.ts run real fetch-handling code. The declarative
      // CacheFirst entry this replaces looked correct but never actually cached video: a
      // <video> element's request carries a `Range` header, the origin correctly answers with
      // 206 Partial Content (see apps/api's MediaController), and Workbox's default
      // cacheable-response check only stores status 200 (or opaque 0) responses — so every
      // 206 was silently dropped and every play, and every playlist loop back to the same
      // clip, re-hit the network. src/sw.ts fixes this by always populating the cache with one
      // full range-header-free fetch, then slicing whatever byte range was actually requested
      // out of that single cached copy (workbox-range-requests' createPartialResponse).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      registerType: 'autoUpdate',
      manifest: {
        name: 'Lumina Player',
        short_name: 'Lumina',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': '/src' },
  },
  optimizeDeps: {
    // @lumina/types is a symlinked workspace package, so Vite skips it in dep pre-bundling
    // by default (it assumes linked packages are already ESM source). Its dist build is
    // CommonJS, though, so it must be force-included to get the CJS->ESM interop transform
    // — otherwise named imports of runtime values (schemas, resolveThemeColor) fail because
    // the raw CJS file gets served to the browser as-is with no real `export` statements.
    include: ['@lumina/types'],
  },
});

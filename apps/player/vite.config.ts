import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.(mp4|webm|jpg|jpeg|png|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'media-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 86400 * 7 },
            },
          },
        ],
      },
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

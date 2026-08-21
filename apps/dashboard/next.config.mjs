import createNextIntlPlugin from 'next-intl/plugin';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Every asset thumbnail/screenshot/preview URL the API returns is `${NEXT_PUBLIC_API_URL}/media/...`
// (StorageService.publicUrl, routed through MediaController) — deriving remotePatterns from that
// same env var, rather than hardcoding a host, keeps this correct across dev/staging/prod without
// needing to know each environment's actual API domain in advance.
const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1');

/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@lumina/ui', '@lumina/types'],
  images: {
    remotePatterns: [
      {
        protocol: apiUrl.protocol.replace(':', ''),
        hostname: apiUrl.hostname,
        port: apiUrl.port,
        pathname: `${apiUrl.pathname.replace(/\/$/, '')}/media/**`,
      },
    ],
  },
  output: 'standalone',
  // Required for pnpm monorepo: trace files from the repo root so shared
  // node_modules are included in the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Opt-in only (DEV_PROXY_API=1): proxies /v1/* to the production API so a
  // locally-run dashboard can browse real prod data without the browser hitting
  // prod's CORS allow-list directly (which only permits the prod dashboard origin).
  ...(process.env.DEV_PROXY_API === '1'
    ? {
        // Separate build dir so this instance can run alongside the regular
        // localhost:3000 dev server (which locks the default .next dir).
        distDir: '.next-prod-proxy',
        async rewrites() {
          return [{ source: '/v1/:path*', destination: 'https://lumina.sparkco.vip/v1/:path*' }];
        },
      }
    : {}),
};

export default withNextIntl(config);

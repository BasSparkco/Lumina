import createNextIntlPlugin from 'next-intl/plugin';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@lumina/ui', '@lumina/types'],
  output: 'standalone',
  // Required for pnpm monorepo: trace files from the repo root so shared
  // node_modules are included in the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default withNextIntl(config);

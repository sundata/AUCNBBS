import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  outputFileTracingRoot: resolve(__dirname, '../..'),
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  transpilePackages: ['@aucn/domain'],
};

export default withNextIntl(nextConfig);

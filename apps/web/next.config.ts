import { loadEnvConfig } from '@next/env';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Next.js only reads .env files from apps/web, but this monorepo keeps a single .env at the
// repo root. Load it here so API_INTERNAL_URL and NEXT_PUBLIC_* (branding) are picked up.
// Variables already set in the environment (e.g. on the hosting platform) are never overridden.
// forceReload: Next has already run loadEnvConfig for apps/web and would otherwise return that cached result.
loadEnvConfig(resolve(process.cwd(), '../..'), process.env.NODE_ENV !== 'production', { info: () => {}, error: console.error }, true);

const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const isProd = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@hrms/shared'],
  // Same-origin API proxy: session cookies stay SameSite=Strict and no CORS is needed.
  async rewrites() {
  if (process.env.VERCEL) {
    return [];
  }

  return [
    {
      source: '/api/v1/:path*',
      destination: `${api}/api/v1/:path*`,
    },
    // ZKTeco biometric devices call fixed /iclock/* paths (BIO-01).
    {
      source: '/iclock/:path*',
      destination: `${api}/iclock/:path*`,
    },
  ];
},
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;

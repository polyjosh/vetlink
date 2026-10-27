import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** Where the API runs (server side only; the browser always talks to this origin). */
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  // Workspace packages are used as TypeScript source (no build step in dev), as in the API.
  // Workspace packages are used as TypeScript source (the `@vetlink/source` export condition), as
  // in the API. Built with webpack: Turbopack can neither add resolve conditions nor map the
  // packages' NodeNext `./x.js` imports to `./x.ts`.
  transpilePackages: [
    '@vetlink/shared',
    '@vetlink/i18n',
    '@vetlink/api-client',
    '@vetlink/ui-tokens',
  ],
  outputFileTracingRoot: root,
  webpack(cfg: {
    resolve: { conditionNames?: string[]; extensionAlias?: Record<string, string[]> };
  }) {
    cfg.resolve.conditionNames = ['@vetlink/source', '...'];
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return cfg;
  },
  // Same-origin API: no CORS, and the API host never reaches the browser.
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${apiUrl}/v1/:path*` }];
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
      // The admin console is never indexed (§12).
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default config;

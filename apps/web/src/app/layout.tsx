import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cssVariables } from '@vetlink/ui-tokens';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'VetLink',
  description: 'Reach a verified vet fast.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1F7A4D' };

// Design tokens (packages/ui-tokens) as CSS variables: the one source for colours and sizes.
const tokens = `:root{${Object.entries(cssVariables())
  .map(([k, v]) => `${k}:${v}`)
  .join(';')}}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sw">
      <head>
        <style>{tokens}</style>
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

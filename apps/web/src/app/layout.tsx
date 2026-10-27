import type { Metadata, Viewport } from 'next';
import { Figtree } from 'next/font/google';
import type { ReactNode } from 'react';
import { color, cssVariables } from '@vetlink/ui-tokens';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'VetLink',
  description: 'Reach a verified vet fast.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: color.primary,
};

// Self-hosted at build time by next/font (no request to Google from the browser).
const figtree = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-figtree',
});

// Design tokens (packages/ui-tokens) as CSS variables: the one source for colours and sizes.
const tokens = `:root{${Object.entries(cssVariables())
  .map(([k, v]) => `${k}:${v}`)
  .join(';')}}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sw" className={figtree.variable}>
      <head>
        <style>{tokens}</style>
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

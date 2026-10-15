'use client';

import type { ReactNode } from 'react';
import { LangProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LangProvider>
      <SessionProvider>{children}</SessionProvider>
    </LangProvider>
  );
}

'use client';

import type { ReactNode } from 'react';
import { RequireRole } from '@/components/shell';

// Application and status pages stay reachable whatever the verification state.
const ALWAYS = ['/vet/application', '/vet/status'];

export default function VetLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="vet" allow={ALWAYS}>
      {children}
    </RequireRole>
  );
}

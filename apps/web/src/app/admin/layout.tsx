'use client';

import type { ReactNode } from 'react';
import { RequireRole } from '@/components/shell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="admin" allow={['/admin']}>
      {children}
    </RequireRole>
  );
}

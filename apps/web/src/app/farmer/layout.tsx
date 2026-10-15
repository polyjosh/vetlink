'use client';

import type { ReactNode } from 'react';
import { RequireRole } from '@/components/shell';

export default function FarmerLayout({ children }: { children: ReactNode }) {
  return <RequireRole role="farmer">{children}</RequireRole>;
}

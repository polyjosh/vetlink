'use client';

import { LinkButton } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useT();
  return (
    <main className="mx-auto max-w-md space-y-4 p-8 text-center">
      <p className="text-xl font-bold">{t.web.common.notFound}</p>
      <LinkButton href="/">{t.web.common.home}</LinkButton>
    </main>
  );
}

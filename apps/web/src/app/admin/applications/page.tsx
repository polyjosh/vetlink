'use client';

import { AdminNav } from '@/components/admin-nav';
import { ApplicationQueue } from '@/components/admin-queue';
import { Shell } from '@/components/shell';
import { Card } from '@/components/ui';
import { useT } from '@/lib/i18n';

/** Verification queue (§13): the list, and the review panel once one is opened. */
export default function Queue() {
  const { t } = useT();
  const a = t.web.admin;
  return (
    <Shell title={a.queue} subtitle={a.queueSubtitle} role="admin" nav={<AdminNav />}>
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[1_1_380px]">
          <ApplicationQueue />
        </div>
        <Card className="hidden min-w-0 flex-[2_1_480px] text-ink-muted wrap:block">
          {a.pickOne}
        </Card>
      </div>
    </Shell>
  );
}

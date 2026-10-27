'use client';

import { useCallback, useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { FollowUpList } from '@/components/follow-ups';
import { Shell } from '@/components/shell';
import { Card, Spinner } from '@/components/ui';
import { VetNav } from '@/components/vet-nav';
import { useT } from '@/lib/i18n';
import { useLoad } from '@/lib/poll';
import { useSession } from '@/lib/session';

export default function FollowUps() {
  const { t } = useT();
  const { api } = useSession();
  const [items, setItems] = useState<Schemas['FollowUp'][] | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.GET('/v1/vets/me/follow-ups');
    setItems(data ?? []);
  }, [api]);
  useLoad(load);
  return (
    <Shell title={t.web.followUps.title} role="vet" nav={<VetNav />}>
      <Card>
        {!items ? (
          <Spinner label={t.web.common.loading} />
        ) : items.length === 0 ? (
          <p className="text-muted">{t.web.followUps.empty}</p>
        ) : (
          <FollowUpList items={items} />
        )}
      </Card>
    </Shell>
  );
}

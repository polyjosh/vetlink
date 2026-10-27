import { FollowUpList } from '../../src/components/follow-ups';
import { Screen } from '../../src/components/screen';
import { Card, Loading, P } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api } from '../../src/lib/session';

export default function FollowUps() {
  const { t } = useT();
  const q = useApi(['vet-follow-ups'], () => api.GET('/v1/vets/me/follow-ups'), {
    cache: 'vet:follow-ups',
  });
  return (
    <Screen
      title={t.web.followUps.title}
      role="vet"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      <Card>
        {!q.data ? (
          <Loading label={t.web.common.loading} />
        ) : q.data.length === 0 ? (
          <P muted>{t.web.followUps.empty}</P>
        ) : (
          <FollowUpList items={q.data} />
        )}
      </Card>
    </Screen>
  );
}

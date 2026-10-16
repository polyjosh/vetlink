import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import type { Schemas } from '@vetlink/api-client';
import { space } from '@vetlink/ui-tokens';
import { Screen } from '../../src/components/screen';
import { P, s } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api } from '../../src/lib/session';

export default function JobHistory() {
  const { t, fmt, lang } = useT();
  const q = useApi(
    ['bookings', 'vet', 'all'],
    () => api.GET('/v1/bookings', { params: { query: { as: 'vet', limit: 50 } } }),
    { cache: 'vet:history' },
  );
  const rows = (q.data ?? []) as Schemas['VetJob'][];
  return (
    <Screen
      title={t.web.vet.jobHistory}
      role="vet"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      {rows.length === 0 && <P muted>{t.web.vet.noJobs}</P>}
      {rows.map((j) => (
        <Pressable
          key={j.id}
          accessibilityRole="link"
          onPress={() => router.push(`/vet/job/${j.id}`)}
          style={[s.row, { minHeight: 48, paddingVertical: space.sm }]}
        >
          <Text
            style={{ flex: 1 }}
          >{`${fmt(t.web.tracking.title, { ref: j.id })} · ${t.ussd.species[j.species]} · ${j.acceptedAt ? new Date(j.acceptedAt).toLocaleDateString(lang) : ''}`}</Text>
          <Text style={{ fontWeight: '700' }}>{t.ussd.statuses[j.status]}</Text>
        </Pressable>
      ))}
    </Screen>
  );
}

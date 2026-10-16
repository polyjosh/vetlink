import { router } from 'expo-router';
import { FlatList, Pressable, Text } from 'react-native';
import type { Schemas } from '@vetlink/api-client';
import { space } from '@vetlink/ui-tokens';
import { Screen } from '../../../src/components/screen';
import { Loading, P, s } from '../../../src/components/ui';
import { useT } from '../../../src/lib/i18n';
import { useApi } from '../../../src/lib/query';
import { api } from '../../../src/lib/session';

export default function History() {
  const { t, fmt, lang } = useT();
  const q = useApi(
    ['bookings', 'farmer', 'all'],
    () => api.GET('/v1/bookings', { params: { query: { as: 'farmer', limit: 50 } } }),
    { cache: 'farmer:history' },
  );
  const rows = (q.data ?? []) as Schemas['FarmerBooking'][];
  return (
    <Screen
      title={t.web.farmer.history}
      role="farmer"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      {!q.data && <Loading label={t.web.common.loading} />}
      {q.data && rows.length === 0 && <P muted>{t.web.farmer.noActive}</P>}
      <FlatList
        scrollEnabled={false}
        data={rows}
        keyExtractor={(b) => String(b.id)}
        renderItem={({ item: b }) => (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(`/farmer/bookings/${b.id}`)}
            style={[s.row, { minHeight: 48, paddingVertical: space.sm }]}
          >
            <Text
              style={{ flex: 1 }}
            >{`${fmt(t.web.tracking.title, { ref: b.id })} · ${t.ussd.species[b.species]} · ${new Date(b.createdAt).toLocaleDateString(lang)}`}</Text>
            <Text style={{ fontWeight: '700' }}>{t.ussd.statuses[b.status]}</Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

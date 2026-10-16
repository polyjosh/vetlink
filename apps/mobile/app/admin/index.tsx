import { Redirect, router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { space } from '@vetlink/ui-tokens';
import { Screen } from '../../src/components/screen';
import { Badge, P, s } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api, useSession } from '../../src/lib/session';

/** Verification queue (§13), the admin task that most needs a phone. */
export default function AdminQueue() {
  const { t, fmt } = useT();
  const { me } = useSession();
  const verifier = me?.admin?.permissions.includes('verifier') ?? false;
  const q = useApi(
    ['admin-queue'],
    () => api.GET('/v1/admin/vet-applications', { params: { query: {} } }),
    {
      enabled: verifier && !!me?.admin?.twoFactorVerified,
      refetchInterval: 30_000,
    },
  );
  const a = t.web.admin;
  if (me?.admin && !me.admin.twoFactorVerified) return <Redirect href="/admin/verify" />;
  return (
    <Screen
      title={a.queue}
      role="admin"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      {!verifier && <P muted>{a.queueEmpty}</P>}
      {(q.data ?? []).length === 0 && verifier && <P muted>{a.queueEmpty}</P>}
      {(q.data ?? []).map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="link"
          onPress={() => router.push(`/admin/application/${r.id}`)}
          style={{ minHeight: 48, paddingVertical: space.sm, gap: 4 }}
        >
          <Text style={{ fontWeight: '700' }}>{`${r.reference} · ${r.name ?? '-'}`}</Text>
          <View style={s.row}>
            {r.resubmission && <Badge>{a.resubmission}</Badge>}
            {r.claimedBy && <Badge tone="success">{a.claimed}</Badge>}
            <Badge tone={r.slaBreached ? 'danger' : 'warning'}>
              {r.slaBreached ? a.slaBreached : fmt(a.age, { hours: r.ageHours })}
            </Badge>
            <Text>{t.web.application.states[r.status]}</Text>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

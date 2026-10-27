import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { TERMINAL_BOOKING_STATUSES } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { colors, space } from '@vetlink/ui-tokens';
import { Screen } from '../../src/components/screen';
import { Button, Card, H2, P, s, Text } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api, useSession } from '../../src/lib/session';
import { PersonAvatar } from '../../src/components/pictures';

/** Farmer home (§8.2): a big Request button, a red Emergency button, the active request. */
export default function FarmerHome() {
  const { t, fmt } = useT();
  const { me } = useSession();
  const recent = useApi(['recent-vets'], () => api.GET('/v1/farmers/me/recent-vets'), {
    cache: 'farmer:recent-vets',
  });
  const list = useApi(
    ['bookings', 'farmer'],
    () => api.GET('/v1/bookings', { params: { query: { as: 'farmer', limit: 20 } } }),
    {
      cache: 'farmer:bookings',
      refetchInterval: 15_000,
    },
  );
  const rows = (list.data ?? []) as Schemas['FarmerBooking'][];
  const active = rows.filter((b) => !TERMINAL_BOOKING_STATUSES.includes(b.status));
  return (
    <Screen
      title={fmt(t.web.farmer.homeTitle, { name: me?.name ? `, ${me.name}` : '' })}
      role="farmer"
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
    >
      <Button
        big
        title={t.web.farmer.requestVet}
        onPress={() => router.push('/farmer/request')}
        testID="request-vet"
      />
      <Button
        big
        variant="danger"
        title={t.web.farmer.emergency}
        onPress={() => router.push('/farmer/request?emergency=1')}
      />
      <P muted>{t.web.farmer.emergencyHint}</P>
      <Card>
        <H2>{t.web.farmer.activeBooking}</H2>
        {active.length === 0 && <P muted>{t.web.farmer.noActive}</P>}
        {active.map((b) => (
          <Pressable
            key={b.id}
            accessibilityRole="link"
            onPress={() => router.push(`/farmer/bookings/${b.id}`)}
            style={[
              s.row,
              { minHeight: 48, backgroundColor: colors.canvas, padding: space.sm, borderRadius: 8 },
            ]}
          >
            <Text style={{ flex: 1 }}>
              {fmt(t.web.tracking.title, { ref: b.id })}: {t.ussd.species[b.species]}
            </Text>
            <Text style={{ fontWeight: '700' }}>{t.ussd.statuses[b.status]}</Text>
          </Pressable>
        ))}
      </Card>
      {(recent.data ?? []).length > 0 && (
        <Card>
          <H2>{t.web.bookAgain.title}</H2>
          {(recent.data ?? []).map((v) => (
            <View key={v.vetId} style={s.row}>
              <PersonAvatar url={v.photoUrl} name={v.name} size={40} />
              {v.available ? (
                <Button
                  variant="secondary"
                  title={fmt(t.web.bookAgain.button, { vet: v.name ?? '' })}
                  onPress={() =>
                    router.push(
                      `/farmer/request?vet=${v.vetId}${v.animalId ? `&animal=${v.animalId}` : ''}`,
                    )
                  }
                />
              ) : (
                <P muted>{`${v.name ?? ''} · ${t.web.bookAgain.unavailable}`}</P>
              )}
            </View>
          ))}
        </Card>
      )}
      <View style={s.row}>
        <Button
          variant="secondary"
          title={t.web.farmer.history}
          onPress={() => router.push('/farmer/bookings')}
        />
        <Button
          variant="secondary"
          title={t.web.farmer.myAnimals}
          onPress={() => router.push('/farmer/animals')}
        />
      </View>
    </Screen>
  );
}

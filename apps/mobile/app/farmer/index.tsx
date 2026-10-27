import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TERMINAL_BOOKING_STATUSES, comingUp, dayBox, speciesCounts } from '@vetlink/shared';
import type { Schemas } from '@vetlink/api-client';
import { color, layout, radius, size, space, statusTone, tone, type } from '@vetlink/ui-tokens';
import { AppBar, Screen } from '../../src/components/screen';
import { Button, Card, Icon, P, SectionLabel, StatusChip, Text, s } from '../../src/components/ui';
import { PersonAvatar } from '../../src/components/pictures';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api, useSession } from '../../src/lib/session';

/**
 * Farmer home (§8.2, FarmerHome.dc.html): greeting, the Request a vet hero, the active request,
 * animal counts and what is coming up. Emergency is chosen in the request form.
 */
export default function FarmerHome() {
  const { t, alt, fmt, lang } = useT();
  const { me } = useSession();
  const insets = useSafeAreaInsets();
  const recent = useApi(['recent-vets'], () => api.GET('/v1/farmers/me/recent-vets'), {
    cache: 'farmer:recent-vets',
  });
  const animals = useApi(['animals'], () => api.GET('/v1/animals'), { cache: 'animals' });
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
  const upcoming = comingUp(rows).slice(0, 3);
  const counts = speciesCounts(animals.data ?? []);
  const f = t.web.farmer;
  const name = me?.displayName ?? me?.name;

  const header = (
    <View>
      <View style={{ paddingTop: insets.top }}>
        <AppBar role="farmer" />
      </View>
      <View style={st.greeting}>
        <Text style={st.hello}>{f.greeting}</Text>
        {name ? (
          <Text accessibilityRole="header" style={st.name}>
            {name}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <Screen
      title={fmt(f.homeTitle, { name: name ? `, ${name}` : '' })}
      role="farmer"
      header={header}
      onRefresh={() => void Promise.all([list.refetch(), animals.refetch()])}
      refreshing={list.isRefetching}
    >
      <View style={st.hero}>
        <View>
          <Text style={st.heroTitle}>{f.heroTitle}</Text>
          <Text style={st.heroHint}>{f.heroHint}</Text>
        </View>
        <Button
          size="lg"
          variant="accent"
          icon="plus"
          title={f.requestVet}
          onPress={() => router.push('/farmer/request')}
          testID="request-vet"
        />
      </View>

      {active.map((b) => {
        const vet = b.vet?.name ?? b.requestedVet?.name;
        const what = fmt(f.activeLine, {
          animal: t.ussd.species[b.species],
          problem: t.ussd.problems[b.problemType].toLowerCase(),
        });
        return (
          <Pressable
            key={b.id}
            accessibilityRole="link"
            onPress={() => router.push(`/farmer/bookings/${b.id}`)}
            style={({ pressed }) => [st.active, pressed && { borderColor: color.primary }]}
          >
            <View style={[st.activeIcon, { backgroundColor: statusTone[b.status].bg }]}>
              <Icon name="mapPin" color={statusTone[b.status].fg} />
            </View>
            <View style={{ flex: 1, gap: space[1] }}>
              <StatusChip status={b.status} />
              <Text style={st.activeTitle}>{vet ? `${vet} · ${what}` : what}</Text>
              <Text style={s.muted}>{fmt(t.web.tracking.title, { ref: b.id })}</Text>
            </View>
            <Icon name="chevronRight" color={color.inkMuted} />
          </Pressable>
        );
      })}

      <View style={st.section}>
        <View style={st.sectionHead}>
          <Text accessibilityRole="header" style={st.sectionTitle}>
            {f.myAnimals}
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/farmer/animals')}
            style={st.link}
          >
            <Text style={st.linkText}>{f.seeAll}</Text>
          </Pressable>
        </View>
        {counts.length === 0 ? (
          <Card>
            <P muted>{t.web.animals.empty}</P>
            <Button
              variant="secondary"
              icon="plus"
              title={t.web.animals.add}
              onPress={() => router.push('/farmer/animals')}
            />
          </Card>
        ) : (
          <View style={st.grid}>
            {counts.map((c) => (
              <View
                key={c.species}
                style={st.count}
                accessible
                accessibilityLabel={`${c.count} ${t.web.ui.speciesPlural[c.species]}`}
              >
                <Text style={st.countN}>{c.count}</Text>
                <Text style={st.countLabel}>{t.web.ui.speciesPlural[c.species]}</Text>
                <Text style={st.countSub}>{alt.web.ui.speciesPlural[c.species]}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={st.section}>
        <Text accessibilityRole="header" style={st.sectionTitle}>
          {f.comingUp}
        </Text>
        {upcoming.length === 0 ? (
          <P muted>{f.comingUpEmpty}</P>
        ) : (
          <View style={st.list}>
            {upcoming.map((u, i) => {
              const box = dayBox(u.at, lang);
              const animal = t.ussd.species[u.species];
              return (
                <Pressable
                  key={u.key}
                  accessibilityRole="link"
                  onPress={() => router.push(`/farmer/bookings/${u.bookingId}`)}
                  style={[st.item, i > 0 && st.itemDivider]}
                >
                  <View style={st.date}>
                    <Text style={st.month}>{box.month}</Text>
                    <Text style={st.day}>{box.day}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemTitle}>
                      {u.kind === 'visit'
                        ? fmt(f.visitItem, { problem: t.ussd.problems[u.problemType], animal })
                        : fmt(f.followUpItem, { animal })}
                    </Text>
                    <Text style={s.muted}>
                      {u.vetName
                        ? fmt(f.withVet, { vet: u.vetName })
                        : u.kind === 'visit'
                          ? f.visitHint
                          : f.followUpHint}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {(recent.data ?? []).length > 0 && (
        <View style={st.section}>
          <SectionLabel>{t.web.bookAgain.title}</SectionLabel>
          {(recent.data ?? []).map((v) => (
            <Card key={v.vetId} style={st.again}>
              <PersonAvatar url={v.photoUrl} name={v.name} size={size.touchMin} />
              {v.available ? (
                <View style={{ flex: 1 }}>
                  <Button
                    variant="secondary"
                    title={fmt(t.web.bookAgain.button, { vet: v.name ?? '' })}
                    onPress={() =>
                      router.push(
                        `/farmer/request?vet=${v.vetId}${v.animalId ? `&animal=${v.animalId}` : ''}`,
                      )
                    }
                  />
                </View>
              ) : (
                <P muted>{`${v.name ?? ''} · ${t.web.bookAgain.unavailable}`}</P>
              )}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  greeting: { paddingHorizontal: layout.mobileGutter, paddingTop: space[2] },
  hello: { fontSize: type.small.size, fontWeight: '500', color: color.inkMuted },
  name: {
    fontSize: type.title.size,
    lineHeight: type.title.line,
    fontWeight: '800',
    letterSpacing: type.display.tracking,
  },
  hero: {
    backgroundColor: color.primary,
    borderRadius: radius.xl,
    padding: space[5],
    gap: space[4],
    marginBottom: space[4],
  },
  heroTitle: {
    color: color.onPrimary,
    fontSize: type.heading.size,
    lineHeight: type.heading.line,
    fontWeight: '800',
  },
  heroHint: { color: color.onPrimaryMuted, marginTop: space[1], lineHeight: type.body.line },
  active: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: color.surface,
    borderWidth: size.border,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[4],
    marginBottom: space[4],
  },
  activeIcon: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTitle: { fontWeight: '700' },
  section: { gap: space[3], marginBottom: space[5] },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: type.heading.size, lineHeight: type.heading.line, fontWeight: '800' },
  link: { minHeight: size.touchMin, justifyContent: 'center', paddingHorizontal: space[2] },
  linkText: { fontSize: type.small.size, fontWeight: '700', color: color.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  count: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: color.surface,
    borderWidth: size.border,
    borderColor: color.border,
    borderRadius: radius.tile,
    paddingVertical: space[3],
    paddingHorizontal: space[3],
  },
  countN: { fontSize: type.title.size, lineHeight: type.title.line, fontWeight: '800' },
  countLabel: { fontSize: type.small.size, fontWeight: '700' },
  countSub: { fontSize: type.label.size, color: color.inkMuted },
  list: {
    backgroundColor: color.surface,
    borderWidth: size.border,
    borderColor: color.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    minHeight: size.touchMin,
  },
  itemDivider: { borderTopWidth: size.border, borderTopColor: color.divider },
  date: { width: size.chip, alignItems: 'center' },
  month: { fontSize: type.label.size, fontWeight: '700', color: tone.warning.fg },
  day: { fontSize: type.heading.size, fontWeight: '800' },
  itemTitle: { fontWeight: '700' },
  again: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});

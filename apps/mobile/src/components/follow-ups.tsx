import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { Pressable, View } from 'react-native';
import type { Schemas } from '@vetlink/api-client';
import { colors, space } from '@vetlink/ui-tokens';
import { useT } from '../lib/i18n';
import { Button, P } from './ui';

/** Upcoming follow-ups (§24.4); contact details appear only within 7 days of the date. */
export function FollowUpList({ items }: { items: Schemas['FollowUp'][] }) {
  const { t, fmt, lang } = useT();
  const f = t.web.followUps;
  const when = (x: Schemas['FollowUp']) =>
    x.daysAway === 0
      ? f.today
      : x.daysAway === 1
        ? f.tomorrow
        : new Date(x.followUpDate).toLocaleDateString(lang);
  return (
    <View style={{ gap: space.sm }}>
      {items.map((x) => (
        <View
          key={x.treatmentId}
          style={{
            gap: space.xs,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingTop: space.sm,
          }}
        >
          <P>{`${when(x)} · ${t.ussd.species[x.species]} · ${x.ward}`}</P>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(`/vet/job/${x.bookingId}`)}
          >
            <P
              muted
            >{`${fmt(f.job, { ref: x.bookingId })}${x.diagnosis ? ` · ${x.diagnosis}` : ''}`}</P>
          </Pressable>
          {x.farmer && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <P>{x.farmer.name ?? '-'}</P>
              {x.farmer.phone && (
                <Button
                  title={t.web.common.call}
                  variant="secondary"
                  onPress={() => void Linking.openURL(`tel:+${x.farmer?.phone ?? ''}`)}
                />
              )}
            </View>
          )}
          {x.rebookedBookingId && <P muted>{fmt(f.rebooked, { ref: x.rebookedBookingId })}</P>}
        </View>
      ))}
    </View>
  );
}

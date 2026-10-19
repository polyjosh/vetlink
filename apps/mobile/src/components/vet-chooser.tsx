import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Schemas } from '@vetlink/api-client';
import { colors, fontSize, radius, space } from '@vetlink/ui-tokens';
import { useT } from '../lib/i18n';
import { api } from '../lib/session';
import { PersonAvatar } from './pictures';
import { PriceLines } from './prices';
import { BadgeChips } from './ratings';
import { Button, Choices, H2, P } from './ui';

export type VetSort = 'distance' | 'rating' | 'price';
type Vet = Schemas['ChoosableVet'];
const kes = (n: number) => n.toLocaleString('en-KE');

const cardStyle = (on: boolean) => ({
  borderWidth: 1,
  borderColor: on ? colors.brand : colors.line,
  backgroundColor: on ? colors.brandLight : colors.surface,
  borderRadius: radius.lg,
  padding: space.md,
  gap: space.xs,
});

function VetRow({
  vet,
  selected,
  onSelect,
}: {
  vet: Vet;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, fmt } = useT();
  const [card, setCard] = useState<Schemas['VetCard'] | null>(null);
  const c = t.web.choose;
  return (
    <View style={cardStyle(selected)}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        onPress={onSelect}
        style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}
      >
        <PersonAvatar url={vet.photoUrl} name={vet.name} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontWeight: '700', fontSize: fontSize.md, color: colors.ink }}>
            {vet.name ?? '-'}
          </Text>
          {vet.displayName && <P muted>{`“${vet.displayName}”`}</P>}
          <P>
            {`${vet.type === 'vet' ? t.web.onboarding.vetTypeVet : t.web.onboarding.vetTypeParavet} · ${
              vet.rating === null ? c.newVet : `★ ${vet.rating.toFixed(1)}`
            } · ${vet.distanceKm === 0 ? c.underKm : fmt(c.km, { km: vet.distanceKm })}`}
          </P>
          <BadgeChips badges={vet.badges} />
        </View>
        <Text style={{ fontWeight: '700', color: colors.ink }}>
          {fmt(t.web.prices.total, { amount: kes(vet.price.total) })}
        </Text>
      </Pressable>
      <Button
        title={c.viewProfile}
        variant="ghost"
        onPress={async () => {
          if (card) return setCard(null);
          const { data } = await api
            .GET('/v1/vets/{vetId}/card', { params: { path: { vetId: vet.vetId } } })
            .catch(() => ({ data: undefined }));
          setCard(data ?? null);
        }}
      />
      {card && (
        <View style={{ gap: space.xs }}>
          {card.bio && <P>{card.bio}</P>}
          <P muted>{card.species.map((s) => t.ussd.species[s]).join(', ')}</P>
          <PriceLines price={vet.price} />
        </View>
      )}
    </View>
  );
}

/** The "choose a vet" list (§24.6); `value` is a vet id, or 'auto' for fastest available. */
export function VetChooser({
  vets,
  value,
  onChange,
  sort,
  onSort,
  showFastest = true,
}: {
  vets: Vet[] | null | undefined;
  value: string | null;
  onChange: (v: string) => void;
  sort: VetSort;
  onSort: (s: VetSort) => void;
  showFastest?: boolean;
}) {
  const { t } = useT();
  const c = t.web.choose;
  return (
    <View style={{ gap: space.sm }}>
      {showFastest && (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: value === 'auto' }}
          onPress={() => onChange('auto')}
          style={cardStyle(value === 'auto')}
        >
          <Text style={{ fontWeight: '700', fontSize: fontSize.md, color: colors.ink }}>
            {`⚡ ${c.fastest}`}
          </Text>
          <P muted>{c.fastestHint}</P>
        </Pressable>
      )}
      <P muted>{c.sortBy}</P>
      <Choices
        options={(['distance', 'rating', 'price'] as const).map((s) => ({
          value: s,
          label: c.sort[s],
        }))}
        value={sort}
        onChange={onSort}
      />
      {!vets ? (
        <P>…</P>
      ) : vets.length === 0 ? (
        <P muted>{c.empty}</P>
      ) : (
        vets.map((v) => (
          <VetRow
            key={v.vetId}
            vet={v}
            selected={value === v.vetId}
            onSelect={() => onChange(v.vetId)}
          />
        ))
      )}
      <P muted>{c.feeAfterAccept}</P>
    </View>
  );
}

export function ClinicList({ clinics }: { clinics: Schemas['Clinic'][] | undefined }) {
  const { t, fmt } = useT();
  const c = t.web.choose;
  if (!clinics?.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <H2>{c.clinicsTitle}</H2>
      <P muted>{c.clinicsHint}</P>
      {clinics.map((x) => (
        <View key={x.vetId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <PersonAvatar url={x.photoUrl} name={x.name} size={40} />
          <View style={{ flex: 1 }}>
            <P>{x.name ?? '-'}</P>
            <P muted>
              {`${x.ward} · ${x.distanceKm === 0 ? c.underKm : fmt(c.km, { km: x.distanceKm })}${x.hours ? ` · ${x.hours}` : ''}`}
            </P>
          </View>
          <Button
            title={c.directions}
            variant="secondary"
            onPress={() =>
              void Linking.openURL(
                `https://www.google.com/maps/dir/?api=1&destination=${x.location.lat},${x.location.lng}`,
              )
            }
          />
        </View>
      ))}
    </View>
  );
}

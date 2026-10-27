import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BookingStatus } from '@vetlink/shared';
import { color, radius, size, space, statusTone, tone, type } from '@vetlink/ui-tokens';
import { useT } from '../../lib/i18n';
import { Icon } from './icon';
import { Text } from './text';

/** 44 px pill toggle. Unselected: white with a border; selected: solid primary. */
export function ChoiceChip({
  selected,
  onPress,
  label,
  testID,
}: {
  selected: boolean;
  onPress: () => void;
  label: string;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      style={[s.chip, selected && s.chipOn]}
    >
      <Text style={[s.chipText, selected && { color: color.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * 72 px tile with the label in the UI language and, under it, the name in the other language
 * (e.g. "Ng'ombe / Cow"). The second line is not read out, so the accessible name is the label.
 */
export function ChoiceTile({
  label,
  secondary,
  selected,
  onPress,
  warning,
  testID,
}: {
  label: string;
  secondary?: string | undefined;
  selected: boolean;
  onPress: () => void;
  warning?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={[s.tile, selected && (warning ? s.tileWarn : s.tileOn)]}
    >
      <Text style={s.tileText}>{label}</Text>
      {secondary && secondary !== label ? <Text style={s.tileSub}>{secondary}</Text> : null}
    </Pressable>
  );
}

/** Pre-v1 tile grid (single or multi choice), now drawn as ChoiceTiles. */
export function Choices<T extends string | number>({
  options,
  value,
  onChange,
  multi,
  columns = 2,
}: {
  options: { value: T; label: string; secondary?: string }[];
  value: T | T[] | null;
  onChange: (v: T) => void;
  multi?: boolean;
  columns?: 2 | 3;
}) {
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <View style={s.grid}>
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          accessibilityRole={multi ? 'checkbox' : 'radio'}
          accessibilityState={{ checked: selected(o.value) }}
          accessibilityLabel={o.label}
          onPress={() => onChange(o.value)}
          style={[
            s.tile,
            { flexBasis: columns === 3 ? '30%' : '47%' },
            selected(o.value) && s.tileOn,
          ]}
        >
          <Text style={s.tileText}>{o.label}</Text>
          {o.secondary && o.secondary !== o.label ? (
            <Text style={s.tileSub}>{o.secondary}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

/** Booking status as text on its tone: status is never shown by colour alone. */
export function StatusChip({ status, testID }: { status: BookingStatus; testID?: string }) {
  const { t } = useT();
  const c = statusTone[status];
  return (
    <View style={[s.status, { backgroundColor: c.bg }]}>
      <Text testID={testID} style={[s.statusText, { color: c.fg }]}>
        {t.ussd.statuses[status]}
      </Text>
    </View>
  );
}

export function VerifiedBadge({ withHint }: { withHint?: boolean }) {
  const { t } = useT();
  return (
    <View style={s.row}>
      <View style={[s.status, s.verified]}>
        <Icon name="shieldCheck" size={18} color={color.primary} />
        <Text style={[s.statusText, { color: color.primary }]}>{t.web.ui.verifiedVet}</Text>
      </View>
      {withHint ? <Text style={s.hint}>{t.web.ui.verifiedHint}</Text> : null}
    </View>
  );
}

/** A tinted pill with any content (counts, tags). */
export function Pill({
  children,
  toneName = 'neutral',
}: {
  children: ReactNode;
  toneName?: keyof typeof tone;
}) {
  return (
    <View style={[s.status, { backgroundColor: tone[toneName].bg }]}>
      <Text style={[s.statusText, { color: tone[toneName].fg }]}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[3] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    minHeight: size.chip,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    borderWidth: size.borderStrong,
    borderColor: color.border,
    backgroundColor: color.surface,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontWeight: '600' },
  tile: {
    minHeight: size.tile,
    flexGrow: 1,
    borderWidth: size.borderTile,
    borderColor: color.border,
    borderRadius: radius.tile,
    backgroundColor: color.surface,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    justifyContent: 'center',
  },
  tileOn: { borderColor: color.primary, backgroundColor: color.primarySoft },
  tileWarn: { borderColor: color.warning, backgroundColor: color.warningSoft },
  tileText: { fontWeight: '700' },
  tileSub: { fontSize: type.small.size, lineHeight: type.small.line, color: color.inkMuted },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1],
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.pill,
  },
  statusText: { fontSize: type.small.size, lineHeight: type.small.line, fontWeight: '700' },
  verified: { backgroundColor: color.primarySoft, paddingLeft: space[2] },
  hint: { fontSize: type.small.size, color: color.inkMuted },
});

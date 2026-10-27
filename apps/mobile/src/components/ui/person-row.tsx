import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { color, radius, size, space, type } from '@vetlink/ui-tokens';
import { useT } from '../../lib/i18n';
import { PersonAvatar } from '../pictures';
import { Icon } from './icon';
import { Text } from './text';

/** A person with a photo or initials, name, optional verified mark, meta line and call button. */
export function PersonRow({
  name,
  photoUrl,
  meta,
  verified,
  phone,
}: {
  name: string;
  photoUrl?: string | null | undefined;
  meta?: ReactNode;
  verified?: boolean;
  phone?: string | null | undefined;
}) {
  const { t, fmt } = useT();
  return (
    <View style={s.row}>
      <PersonAvatar url={photoUrl} name={name} size={size.avatar} />
      <View style={s.body}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>
            {name}
          </Text>
          {verified ? (
            <Icon
              name="shieldCheck"
              size={size.iconSm}
              color={color.primary}
              label={t.web.ui.verifiedVet}
            />
          ) : null}
        </View>
        {meta ? <Text style={s.meta}>{meta}</Text> : null}
      </View>
      {phone ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fmt(t.web.ui.callPerson, { name })}
          onPress={() => void Linking.openURL(`tel:+${phone.replace(/^\+/, '')}`)}
          style={({ pressed }) => [s.call, pressed && { backgroundColor: color.primaryPressed }]}
        >
          <Icon name="phone" color={color.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  body: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  name: {
    fontSize: type.heading.size,
    lineHeight: type.heading.line,
    fontWeight: '700',
    flexShrink: 1,
  },
  meta: { fontSize: type.small.size, lineHeight: type.small.line, color: color.inkMuted },
  call: {
    width: size.avatar,
    height: size.avatar,
    borderRadius: radius.md,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

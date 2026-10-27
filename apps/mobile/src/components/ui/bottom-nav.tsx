import { router, usePathname, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, size, space, type, type IconName } from '@vetlink/ui-tokens';
import { Icon } from './icon';
import { Text } from './text';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Active only on this exact path (a section's home), not on paths below it. */
  exact?: boolean;
}

/** Four sections, icon above label. Active: primarySoft pill behind the icon, primary, weight 800. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[s.bar, { paddingBottom: Math.max(insets.bottom, space[1]) }]}
      accessibilityRole="tablist"
    >
      {items.map((it) => {
        const active = it.exact
          ? path === it.href
          : path === it.href || path.startsWith(`${it.href}/`);
        const fg = active ? color.primary : color.inkMuted;
        return (
          <Pressable
            key={it.href}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={it.label}
            onPress={() => {
              if (!active) router.navigate(it.href as Href);
            }}
            style={s.item}
          >
            <View style={[s.pill, active && { backgroundColor: color.primarySoft }]}>
              <Icon name={it.icon} color={fg} />
            </View>
            <Text
              style={[s.label, { color: fg, fontWeight: active ? '800' : '600' }]}
              numberOfLines={1}
            >
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderTopWidth: size.border,
    borderTopColor: color.border,
    paddingTop: space[1],
  },
  item: {
    flex: 1,
    minHeight: size.navItem,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
  pill: { paddingHorizontal: space[4], paddingVertical: space[1] / 2, borderRadius: radius.pill },
  label: { fontSize: type.label.size, lineHeight: type.label.line },
});

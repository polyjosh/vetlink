import { Pressable, StyleSheet, View } from 'react-native';
import type { Locale } from '@vetlink/i18n';
import { color, nativeShadow, radius, size, space, type } from '@vetlink/ui-tokens';
import { useLang, useT } from '../../lib/i18n';
import { Text } from './text';

/** EN / SW segmented pill wired to the app's language switch. */
export function LanguageToggle({ inverse }: { inverse?: boolean }) {
  const { t } = useT();
  const { lang, setLang } = useLang();
  const options: { value: Locale; short: string; name: string }[] = [
    { value: 'en', short: t.web.ui.langEn, name: t.web.common.english },
    { value: 'sw', short: t.web.ui.langSw, name: t.web.common.swahili },
  ];
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t.web.common.language}
      style={[s.group, { backgroundColor: inverse ? color.primaryPressed : color.primarySoft }]}
    >
      {options.map((o) => {
        const on = lang === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={o.name}
            onPress={() => setLang(o.value)}
            hitSlop={space[1]}
            style={[s.option, on && [s.on, nativeShadow.raised]]}
          >
            <Text
              style={[
                s.text,
                {
                  color: on
                    ? inverse
                      ? color.primary
                      : color.ink
                    : inverse
                      ? color.onPrimary
                      : color.primary,
                },
              ]}
            >
              {o.short}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  group: { flexDirection: 'row', padding: space[1], borderRadius: radius.pill },
  option: {
    minHeight: size.touchMin - space[2],
    minWidth: size.touchMin,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: { backgroundColor: color.surface },
  text: { fontSize: type.small.size, fontWeight: '700' },
});

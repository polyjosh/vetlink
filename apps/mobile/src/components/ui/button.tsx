import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius, size as sizes, space, type, type IconName } from '@vetlink/ui-tokens';
import { Icon } from './icon';
import { Text } from './text';

/**
 * Buttons (design system v1). `accent` (amber, ink text) is for urgent or emergency actions only;
 * one primary action per screen.
 */
export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'xl' | 'lg' | 'md';

const look: Record<ButtonVariant, { bg: string; fg: string; border?: string; pressed: string }> = {
  primary: { bg: color.primary, fg: color.onPrimary, pressed: color.primaryPressed },
  accent: { bg: color.accent, fg: color.ink, pressed: color.accent },
  secondary: {
    bg: color.surface,
    fg: color.primary,
    border: color.primary,
    pressed: color.primarySoft,
  },
  ghost: { bg: 'transparent', fg: color.primary, pressed: color.primarySoft },
  danger: { bg: color.surface, fg: color.danger, border: color.danger, pressed: color.dangerSoft },
};

const height: Record<ButtonSize, number> = {
  xl: sizes.buttonXl,
  lg: sizes.buttonLg,
  md: sizes.buttonMd,
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size,
  big,
  disabled,
  icon,
  trailingIcon,
  testID,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Pre-v1 name for `size="lg"`. */
  big?: boolean;
  disabled?: boolean | undefined;
  icon?: IconName | undefined;
  trailingIcon?: IconName | undefined;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const v = look[variant];
  const sz = size ?? (big ? 'lg' : 'md');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          minHeight: height[sz],
          backgroundColor: pressed ? v.pressed : v.bg,
          opacity: disabled ? 0.5 : 1,
        },
        v.border ? { borderWidth: sizes.borderStrong, borderColor: v.border } : null,
      ]}
    >
      <View style={s.content}>
        {icon && <Icon name={icon} color={v.fg} />}
        <Text
          style={[
            s.text,
            { color: v.fg },
            sz !== 'md' && { fontSize: type.button.size, lineHeight: type.button.line },
          ]}
        >
          {title}
        </Text>
        {trailingIcon && <Icon name={trailingIcon} color={v.fg} />}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    paddingHorizontal: space[5],
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: space[1],
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  text: { fontSize: type.body.size, fontWeight: '700', textAlign: 'center' },
});

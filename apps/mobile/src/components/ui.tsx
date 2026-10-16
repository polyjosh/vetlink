import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, fontSize, radius, space, touchTarget } from '@vetlink/ui-tokens';

/** Big, high-contrast controls for low-end phones in bright sun (§11). */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const buttonBg: Record<Variant, string> = {
  primary: colors.brand,
  secondary: colors.surface,
  danger: colors.emergency,
  ghost: 'transparent',
};
const buttonFg: Record<Variant, string> = {
  primary: colors.surface,
  secondary: colors.ink,
  danger: colors.surface,
  ghost: colors.brand,
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  big,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean | undefined;
  big?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: buttonBg[variant], opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && s.outlined,
        big && s.big,
      ]}
    >
      <Text style={[s.buttonText, { color: buttonFg[variant] }, big && s.bigText]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.h1}>
      {children}
    </Text>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.h2}>
      {children}
    </Text>
  );
}

export function P({
  children,
  muted,
  testID,
}: {
  children: ReactNode;
  muted?: boolean;
  testID?: string;
}) {
  return (
    <Text testID={testID} style={[s.p, muted && s.muted]}>
      {children}
    </Text>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string | undefined }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[s.input, props.multiline && s.multiline]}
      />
      {hint ? <Text style={s.muted}>{hint}</Text> : null}
    </View>
  );
}

export function ErrorText({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" style={s.error}>
      {message}
    </Text>
  );
}

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'success';
}) {
  const bg = { info: colors.infoLight, warning: colors.warningLight, success: colors.brandLight }[
    tone
  ];
  const fg = { info: colors.info, warning: colors.warning, success: colors.brandDark }[tone];
  return (
    <View style={[s.notice, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: fontSize.md }}>{children}</Text>
    </View>
  );
}

export function Badge({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'danger' | 'success';
}) {
  const bg = {
    info: colors.infoLight,
    warning: colors.warningLight,
    danger: colors.emergencyLight,
    success: colors.brandLight,
  }[tone];
  const fg = {
    info: colors.info,
    warning: colors.warning,
    danger: colors.emergency,
    success: colors.brandDark,
  }[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: fontSize.sm }}>{children}</Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={s.center} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.brand} size="large" />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

/** One big tap target per option (icon-grid style, §8.2). */
export function Choices<T extends string | number>({
  options,
  value,
  onChange,
  multi,
}: {
  options: { value: T; label: string }[];
  value: T | T[] | null;
  onChange: (v: T) => void;
  multi?: boolean;
}) {
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <View style={s.grid}>
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          accessibilityRole={multi ? 'checkbox' : 'radio'}
          accessibilityState={{ checked: selected(o.value) }}
          onPress={() => onChange(o.value)}
          style={[s.choice, selected(o.value) && s.choiceOn]}
        >
          <Text style={s.choiceText}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  button: {
    minHeight: touchTarget,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: space.xs,
  },
  outlined: { borderWidth: 1, borderColor: colors.line },
  big: { minHeight: touchTarget * 2 },
  buttonText: { fontSize: fontSize.md, fontWeight: '700' },
  bigText: { fontSize: fontSize.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    marginBottom: space.md,
    gap: space.sm,
  },
  h1: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.ink, marginBottom: space.md },
  h2: { fontSize: fontSize.lg, fontWeight: '700', color: colors.ink },
  p: { fontSize: fontSize.md, color: colors.ink },
  muted: { fontSize: fontSize.sm, color: colors.muted },
  field: { gap: space.xs, marginBottom: space.sm },
  label: { fontSize: fontSize.md, fontWeight: '700', color: colors.ink },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    fontSize: fontSize.md,
    color: colors.ink,
  },
  multiline: { minHeight: touchTarget * 2, textAlignVertical: 'top', paddingTop: space.sm },
  error: {
    backgroundColor: colors.emergencyLight,
    color: colors.emergency,
    padding: space.md,
    borderRadius: radius.md,
    fontSize: fontSize.md,
  },
  notice: { padding: space.md, borderRadius: radius.md, marginBottom: space.sm },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  center: { padding: space.xxl, alignItems: 'center', gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choice: {
    minHeight: touchTarget,
    minWidth: '47%',
    flexGrow: 1,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: space.md,
    justifyContent: 'center',
  },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  choiceText: { fontSize: fontSize.md, fontWeight: '700', color: colors.ink },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
});

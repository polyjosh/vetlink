import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type ViewStyle } from 'react-native';
import {
  color,
  nativeShadow,
  radius,
  space,
  tone as tones,
  type,
  type Tone,
} from '@vetlink/ui-tokens';
import { Text } from './text';

/** Surface card: border by default (cheap in long lists), `raised` for sheets and sticky bars. */
export function Card({
  children,
  style,
  raised,
}: {
  children: ReactNode;
  style?: ViewStyle | (ViewStyle | false | undefined)[];
  raised?: boolean;
}) {
  return <View style={[s.card, raised && nativeShadow.raised, style]}>{children}</View>;
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

/** Small uppercase section label (`type.label`). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.sectionLabel}>
      {children}
    </Text>
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

export type NoticeTone = 'info' | 'warning' | 'success' | 'danger';

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: NoticeTone }) {
  return (
    <View style={[s.notice, { backgroundColor: tones[tone].bg }]}>
      <Text style={{ color: tones[tone].fg }}>{children}</Text>
    </View>
  );
}

export function Badge({ children, tone = 'info' }: { children: ReactNode; tone?: Tone }) {
  return (
    <View style={[s.badge, { backgroundColor: tones[tone].bg }]}>
      <Text style={[s.badgeText, { color: tones[tone].fg }]}>{children}</Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={s.center} accessibilityLiveRegion="polite">
      <ActivityIndicator color={color.primary} size="large" />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: space[4],
    marginBottom: space[3],
    gap: space[2],
  },
  h1: {
    fontSize: type.title.size,
    lineHeight: type.title.line,
    fontWeight: '800',
    marginBottom: space[3],
  },
  h2: { fontSize: type.heading.size, lineHeight: type.heading.line, fontWeight: '700' },
  p: { fontSize: type.body.size, lineHeight: type.body.line },
  muted: { fontSize: type.small.size, lineHeight: type.small.line, color: color.inkMuted },
  sectionLabel: {
    fontSize: type.label.size,
    lineHeight: type.label.line,
    fontWeight: '700',
    letterSpacing: type.label.tracking,
    textTransform: 'uppercase',
    color: color.inkMuted,
  },
  error: {
    backgroundColor: color.dangerSoft,
    color: color.danger,
    padding: space[3],
    borderRadius: radius.md,
  },
  notice: { padding: space[3], borderRadius: radius.md, marginBottom: space[2] },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.pill,
  },
  badgeText: { fontSize: type.small.size, lineHeight: type.small.line, fontWeight: '700' },
  center: { padding: space[8], alignItems: 'center', gap: space[3] },
});

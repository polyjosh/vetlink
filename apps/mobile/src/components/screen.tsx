import { Redirect, router, usePathname } from 'expo-router';
import { useNetworkState } from 'expo-network';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { resolveHomeRoute, type SessionRole } from '@vetlink/shared';
import { color, layout, size, space, type } from '@vetlink/ui-tokens';
import { useSync } from '../offline/sync';
import { useT } from '../lib/i18n';
import { ROUTE_PATHS, rememberRole } from '../lib/role';
import { useSession } from '../lib/session';
import { Badge, H1, Icon, LanguageToggle, Loading, LogoMark, Text } from './ui';

function HeaderLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ minHeight: size.touchMin, justifyContent: 'center', paddingHorizontal: space[2] }}
    >
      <Text style={{ color: color.primary, fontWeight: '700', fontSize: type.small.size }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The app bar: wordmark, language toggle, other roles, profile. */
export function AppBar({ role }: { role?: SessionRole | undefined }) {
  const { t } = useT();
  const { me } = useSession();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: space[2],
        paddingHorizontal: layout.mobileGutter,
        paddingVertical: space[1],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flex: 1 }}>
        <LogoMark crossColor={color.primary} />
        <Text style={{ fontSize: type.heading.size, fontWeight: '800' }}>VetLink</Text>
      </View>
      <LanguageToggle />
      {(me?.roles ?? [])
        .filter((r) => r !== role)
        .map((r) => (
          <HeaderLink
            key={r}
            label={`${t.web.common.switchRole} ${t.web.roles[r]}`}
            onPress={() => {
              rememberRole(r);
              router.replace('/');
            }}
          />
        ))}
      {me && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.web.profile.title}
          onPress={() => router.push('/settings')}
          style={{
            width: size.touchMin,
            height: size.touchMin,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="settings" color={color.inkMuted} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Every screen: header, offline banner, pending-sync badge, pull to refresh (§11 states).
 * `header` replaces the app bar and title (designed screens draw their own); `footer` is a
 * sticky bottom bar.
 */
export function Screen({
  title,
  role,
  children,
  onRefresh,
  refreshing = false,
  header,
  footer,
  hideTitle,
  padded = true,
}: {
  title: string;
  role?: SessionRole;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  hideTitle?: boolean;
  padded?: boolean;
}) {
  const { t, fmt } = useT();
  const net = useNetworkState();
  const pending = useSync((st) => st.items.filter((i) => i.state === 'pending').length);
  const failed = useSync((st) => st.items.filter((i) => i.state === 'failed').length);
  const offline = net.isConnected === false || net.isInternetReachable === false;
  return (
    <SafeAreaView
      edges={header ? ['left', 'right'] : ['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: color.ground }}
    >
      {!header && <AppBar role={role} />}
      {offline && (
        <View style={{ backgroundColor: color.warningSoft, padding: space[2] }}>
          <Text style={{ color: color.warning, textAlign: 'center' }}>{t.web.common.offline}</Text>
        </View>
      )}
      <ScrollView
        contentContainerStyle={{ paddingBottom: space[8] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        {header}
        <View
          style={
            padded ? { paddingHorizontal: layout.mobileGutter, paddingTop: space[4] } : undefined
          }
        >
          {!header && !hideTitle && <H1>{title}</H1>}
          {(pending > 0 || failed > 0) && (
            <View
              style={{ flexDirection: 'row', gap: space[2], marginBottom: space[3] }}
              testID="pending-sync"
            >
              {pending > 0 && (
                <Badge tone="warning">{fmt(t.web.mobile.pendingSync, { n: pending })}</Badge>
              )}
              {failed > 0 && (
                <Badge tone="danger">{fmt(t.web.mobile.syncFailed, { n: failed })}</Badge>
              )}
            </View>
          )}
          {children}
        </View>
      </ScrollView>
      {footer}
    </SafeAreaView>
  );
}

/**
 * Route guard (UX only; the API authorizes every call): sends the user where their state says
 * (§8.0) when this section is not it.
 */
export function RequireRole({
  role,
  allow = [],
  children,
}: {
  role: SessionRole;
  allow?: string[];
  children: ReactNode;
}) {
  const { status, me } = useSession();
  const { t } = useT();
  const path = usePathname();
  if (status === 'loading') return <Loading label={t.web.common.loading} />;
  if (status === 'signed_out') return <Redirect href="/login" />;
  if (!me) return <>{children}</>; // offline with a saved session: show cached screens
  if (!me.roles.includes(role)) return <Redirect href="/" />;
  const target = ROUTE_PATHS[resolveHomeRoute(me, role).route];
  if (!path.startsWith(target) && !allow.some((p) => path.startsWith(p)))
    return <Redirect href={target} />;
  return <>{children}</>;
}

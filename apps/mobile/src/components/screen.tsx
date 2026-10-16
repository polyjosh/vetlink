import { Redirect, router, usePathname } from 'expo-router';
import { useNetworkState } from 'expo-network';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { resolveHomeRoute, type SessionRole } from '@vetlink/shared';
import { colors, fontSize, space, touchTarget } from '@vetlink/ui-tokens';
import { useSync } from '../offline/sync';
import { useLang, useT } from '../lib/i18n';
import { ROUTE_PATHS, rememberRole } from '../lib/role';
import { useSession } from '../lib/session';
import { Badge, H1, Loading } from './ui';

function HeaderLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: space.sm }}
    >
      <Text style={{ color: colors.ink, textDecorationLine: 'underline', fontSize: fontSize.sm }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Every screen: header, offline banner, pending-sync badge, pull to refresh (§11 states). */
export function Screen({
  title,
  role,
  children,
  onRefresh,
  refreshing = false,
}: {
  title: string;
  role?: SessionRole;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { t, fmt } = useT();
  const { lang, setLang } = useLang();
  const { me } = useSession();
  const net = useNetworkState();
  const pending = useSync((st) => st.items.filter((i) => i.state === 'pending').length);
  const failed = useSync((st) => st.items.filter((i) => i.state === 'failed').length);
  const offline = net.isConnected === false || net.isInternetReachable === false;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.lg,
          flexWrap: 'wrap',
        }}
      >
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: colors.brand, flex: 1 }}>
          VetLink
        </Text>
        <HeaderLink
          label={lang === 'sw' ? t.web.common.english : t.web.common.swahili}
          onPress={() => setLang(lang === 'sw' ? 'en' : 'sw')}
        />
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
          <HeaderLink label={t.web.common.settings} onPress={() => router.push('/settings')} />
        )}
      </View>
      {offline && (
        <View style={{ backgroundColor: colors.warningLight, padding: space.sm }}>
          <Text style={{ color: colors.warning, textAlign: 'center' }}>{t.web.common.offline}</Text>
        </View>
      )}
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        <H1>{title}</H1>
        {(pending > 0 || failed > 0) && (
          <View
            style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}
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
      </ScrollView>
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

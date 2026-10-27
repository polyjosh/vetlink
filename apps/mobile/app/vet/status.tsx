import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { applicationChecklist } from '@vetlink/shared';
import { color, radius, size, space, tone, type, type Tone } from '@vetlink/ui-tokens';
import { Screen } from '../../src/components/screen';
import {
  Button,
  Card,
  ErrorText,
  H2,
  Icon,
  Loading,
  Notice,
  P,
  Text,
} from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api, useSession } from '../../src/lib/session';

/** Application status (§8.3): reference, state, what to fix, or the approval orientation. */
export default function VetStatus() {
  const { t, fmt, err } = useT();
  const { me, reloadMe } = useSession();
  const q = useApi(['application'], () => api.GET('/v1/vets/me/application'), {
    cache: 'vet:application',
    refetchInterval: 30_000,
  });
  const [error, setError] = useState<string | null>(null);
  const app = q.data;
  const a = t.web.application;
  const vetStatus = me?.vet?.verificationStatus;
  if (!app)
    return (
      <Screen title={a.statusTitle} role="vet">
        <Loading label={t.web.common.loading} />
      </Screen>
    );
  const items = applicationChecklist(app);
  const flagged = items.filter((i) => i.state === 'flagged').length;
  // Warning for "changes needed", info while in review, success once approved.
  const bannerTone: Tone =
    vetStatus === 'suspended' || app.status === 'rejected'
      ? 'danger'
      : app.status === 'changes_requested'
        ? 'warning'
        : app.status === 'approved'
          ? 'success'
          : app.status === 'draft' || app.status === 'withdrawn'
            ? 'neutral'
            : 'info';
  return (
    <Screen
      title={a.statusTitle}
      role="vet"
      onRefresh={() => void Promise.all([q.refetch(), reloadMe()])}
      refreshing={q.isRefetching}
    >
      <View style={[st.banner, { backgroundColor: tone[bannerTone].bg }]}>
        <Text style={[st.bannerTitle, { color: tone[bannerTone].fg }]}>
          {vetStatus === 'suspended' ? a.suspendedTitle : a.states[app.status]}
        </Text>
        {flagged > 0 && (
          <Text style={{ fontWeight: '700', color: tone[bannerTone].fg }}>
            {fmt(a.itemsToFix, { n: flagged })}
          </Text>
        )}
        <Text style={st.small}>{fmt(a.reference, { ref: app.reference })}</Text>
        {(app.status === 'submitted' || app.status === 'under_review') && (
          <Text style={st.small}>{fmt(a.reviewTarget, { hours: app.reviewTargetHours })}</Text>
        )}
        {app.status !== 'approved' && vetStatus !== 'suspended' && (
          <Text style={st.small}>{a.noRequestsUntil}</Text>
        )}
      </View>
      {app.decision && app.status !== 'approved' && (
        <Card>
          <H2>{app.status === 'rejected' ? a.rejectedTitle : a.changesTitle}</H2>
          {app.decision.reasons.map((r) => (
            <P key={r}>{`• ${t.application.reasons[r]}`}</P>
          ))}
          {app.decision.note && <P>{`${a.noteFromReviewer}: ${app.decision.note}`}</P>}
        </Card>
      )}
      {app.status !== 'draft' && app.status !== 'withdrawn' && (
        <Card style={st.list}>
          <View style={st.listHead}>
            <H2>{a.checklistTitle}</H2>
          </View>
          {items.map((it, i) => {
            const fix = it.state === 'flagged';
            const label = it.kind === 'step' ? a.steps[it.step] : a.docKinds[it.doc];
            const state = fix
              ? a.itemFlagged
              : it.state === 'accepted'
                ? a.itemAccepted
                : a.itemInReview;
            return (
              <View
                key={it.kind === 'step' ? it.step : `doc-${it.doc}`}
                style={[
                  st.item,
                  i > 0 && st.divider,
                  fix && { backgroundColor: color.warningSoft },
                ]}
              >
                <View
                  style={[
                    st.icon,
                    {
                      backgroundColor: fix
                        ? color.warning
                        : it.state === 'accepted'
                          ? color.successSoft
                          : color.neutralSoft,
                    },
                  ]}
                >
                  <Icon
                    name={fix ? 'alert' : it.state === 'accepted' ? 'check' : 'clock'}
                    size={16}
                    color={
                      fix
                        ? color.onPrimary
                        : it.state === 'accepted'
                          ? color.success
                          : color.inkMuted
                    }
                  />
                </View>
                <View style={{ flex: 1, gap: space[1] }}>
                  <View style={st.itemHead} accessible accessibilityLabel={`${label}: ${state}`}>
                    <Text style={{ fontWeight: '700', flexShrink: 1 }}>{label}</Text>
                    <Text
                      style={[
                        st.small,
                        { fontWeight: '700', color: fix ? color.warning : color.inkMuted },
                      ]}
                    >
                      {state}
                    </Text>
                  </View>
                  {fix && it.kind === 'doc' && it.note ? (
                    <Text style={st.small}>{it.note}</Text>
                  ) : null}
                  {fix && (
                    <Button
                      variant="secondary"
                      icon={it.kind === 'doc' ? 'camera' : undefined}
                      title={a.fixItem}
                      onPress={() => router.push('/vet/application')}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </Card>
      )}
      <View style={st.privacy}>
        <Icon name="lock" size={size.iconSm} color={color.inkMuted} />
        <Text style={[st.small, { flex: 1, color: color.inkMuted }]}>{a.privacyLine}</Text>
      </View>
      {(vetStatus === 'suspended' || app.status === 'rejected') && (
        <Notice>{a.contactSupport}</Notice>
      )}
      {app.status === 'approved' && vetStatus === 'approved' && (
        <Card>
          <H2>{a.approvedTitle}</H2>
          <P>{a.orientation}</P>
          <Button title={a.continue} onPress={() => router.replace('/vet')} />
        </Card>
      )}
      {(app.status === 'draft' || app.status === 'withdrawn') && (
        <Button title={a.continue} onPress={() => router.push('/vet/application')} />
      )}
      {app.status === 'changes_requested' && (
        <Button
          size="lg"
          title={a.fixAndResubmit}
          onPress={() => router.push('/vet/application')}
        />
      )}
      {app.status === 'submitted' && (
        <Button
          variant="secondary"
          title={a.withdraw}
          onPress={async () => {
            try {
              const { error: e } = await api.POST('/v1/vets/me/application/withdraw');
              if (e) return setError(err(e));
              await reloadMe();
              router.replace('/vet/application');
            } catch {
              setError(t.web.common.offline);
            }
          }}
        />
      )}
      <ErrorText message={error} />
    </Screen>
  );
}

const st = StyleSheet.create({
  banner: { borderRadius: radius.lg, padding: space[4], gap: space[1], marginBottom: space[3] },
  bannerTitle: { fontSize: type.title.size, lineHeight: type.title.line, fontWeight: '800' },
  small: { fontSize: type.small.size, lineHeight: type.small.line },
  list: { padding: 0, gap: 0, overflow: 'hidden' },
  listHead: { padding: space[4], paddingBottom: space[2] },
  item: {
    flexDirection: 'row',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  divider: { borderTopWidth: size.border, borderTopColor: color.divider },
  icon: {
    width: size.icon + space[1],
    height: size.icon + space[1],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space[2],
  },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginVertical: space[3] },
});

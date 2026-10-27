import { View } from 'react-native';
import { RATING_TAGS } from '@vetlink/shared';
import { colors, radius, space } from '@vetlink/ui-tokens';
import { EmptyState } from '../../src/components/pictures';
import { Screen } from '../../src/components/screen';
import { Card, H1, H2, Loading, P } from '../../src/components/ui';
import { useT } from '../../src/lib/i18n';
import { useApi } from '../../src/lib/query';
import { api } from '../../src/lib/session';

/** The vet's ratings (§24.4): summary, what farmers said, the latest ones. No farmer names. */
export default function VetRatings() {
  const { t, fmt, lang } = useT();
  const q = useApi(['vet-ratings'], () => api.GET('/v1/vets/me/ratings'), {
    cache: 'vet:ratings',
  });
  const r = t.web.ratings;
  const data = q.data;
  return (
    <Screen
      title={r.title}
      role="vet"
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
    >
      {!data ? (
        <Loading label={t.web.common.loading} />
      ) : data.count === 0 ? (
        <Card>
          <EmptyState kind="noRatings" text={r.empty} />
        </Card>
      ) : (
        <>
          <Card>
            <H1>{`★ ${data.average?.toFixed(1) ?? '-'}`}</H1>
            <P muted>{fmt(r.count, { n: data.count })}</P>
            {([5, 4, 3, 2, 1] as const).map((n) => (
              <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <P>{`${n}★`}</P>
                <View
                  style={{
                    flex: 1,
                    height: 12,
                    backgroundColor: colors.canvas,
                    borderRadius: radius.pill,
                  }}
                >
                  <View
                    style={{
                      width: `${(data.distribution[n] / data.count) * 100}%`,
                      height: 12,
                      backgroundColor: colors.brand,
                      borderRadius: radius.pill,
                    }}
                  />
                </View>
                <P>{String(data.distribution[n])}</P>
              </View>
            ))}
          </Card>
          <Card>
            <H2>{r.tagsTitle}</H2>
            {RATING_TAGS.filter((tag) => (data.tagCounts[tag] ?? 0) > 0).map((tag) => (
              <P key={tag}>{`${r.tags[tag]} · ${data.tagCounts[tag]}`}</P>
            ))}
          </Card>
          <Card>
            {data.items.map((i) => (
              <View
                key={i.bookingId}
                style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.sm }}
              >
                <P>{`${'★'.repeat(i.stars)}  ${fmt(r.job, { ref: i.bookingId })} · ${t.ussd.species[i.species]} · ${new Date(i.createdAt).toLocaleDateString(lang)}`}</P>
                {i.tags.length > 0 && <P muted>{i.tags.map((tag) => r.tags[tag]).join(' · ')}</P>}
                {i.comment && <P>{`“${i.comment}”`}</P>}
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

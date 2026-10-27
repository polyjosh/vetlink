import { View } from 'react-native';
import { colors, space } from '@vetlink/ui-tokens';
import { useT } from '../lib/i18n';
import { useApi } from '../lib/query';
import { api } from '../lib/session';
import { Card, H1, H2, P } from './ui';

/** The farmer's VetLink credit (§24.25): balance and recent entries. */
export function WalletCard() {
  const { t, fmt, lang } = useT();
  const q = useApi(['wallet'], () => api.GET('/v1/wallet'), { cache: 'farmer:wallet' });
  const x = t.web.wallet;
  const w = q.data;
  if (!w) return null;
  return (
    <Card>
      <H2>{x.title}</H2>
      <H1>{fmt(x.balance, { amount: w.balance.toLocaleString('en-KE') })}</H1>
      <P muted>{x.balanceHint}</P>
      {w.entries.length === 0 ? (
        <P muted>{x.empty}</P>
      ) : (
        w.entries.slice(0, 10).map((e) => (
          <View
            key={e.id}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: space.sm,
              borderTopWidth: 1,
              borderTopColor: colors.line,
              paddingTop: space.xs,
            }}
          >
            <P>{`${x.kinds[e.kind]}${e.bookingId !== null ? ` · #${e.bookingId}` : ''} · ${new Date(e.createdAt).toLocaleDateString(lang)}`}</P>
            <P>{`${e.amount > 0 ? '+' : ''}${e.amount.toLocaleString('en-KE')}`}</P>
          </View>
        ))
      )}
    </Card>
  );
}

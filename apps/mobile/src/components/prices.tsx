import { Switch, Text, TextInput, View, type TextStyle } from 'react-native';
import {
  WEEKDAYS,
  type PriceBreakdown,
  type PriceRange,
  type VetService,
  type WorkingHours,
} from '@vetlink/shared';
import { colors, fontSize, radius, space, touchTarget } from '@vetlink/ui-tokens';
import { useT } from '../lib/i18n';
import { P, s } from './ui';

type Band = { min: number; max: number };
const kes = (n: number) => n.toLocaleString('en-KE');

const input = {
  minHeight: touchTarget,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.md,
  paddingHorizontal: space.md,
  fontSize: fontSize.md,
  color: colors.ink,
  backgroundColor: colors.surface,
};

/** "From" price per service the vet offers (§24.3). */
export function FeesEditor({
  services,
  value,
  onChange,
  bands,
  disabled,
}: {
  services: readonly VetService[];
  value: Partial<Record<VetService, number>>;
  onChange: (v: Partial<Record<VetService, number>>) => void;
  bands?: Partial<Record<VetService, Band>> | undefined;
  disabled?: boolean;
}) {
  const { t, fmt } = useT();
  return (
    <View style={{ gap: space.sm }}>
      {services.map((sv) => {
        const band = bands?.[sv];
        return (
          <View key={sv} style={{ gap: space.xs }}>
            <View style={s.row}>
              <Text style={{ flex: 1, fontWeight: '700', fontSize: fontSize.md }}>
                {t.web.application.services[sv]}
              </Text>
              <Text>KES</Text>
              <TextInput
                accessibilityLabel={t.web.application.services[sv]}
                keyboardType="number-pad"
                editable={!disabled}
                style={[input, { width: 110 }]}
                value={value[sv] === undefined ? '' : String(value[sv])}
                onChangeText={(x) => {
                  const digits = x.replace(/\D/g, '');
                  onChange({ ...value, [sv]: digits === '' ? undefined : Number(digits) });
                }}
              />
            </View>
            {band && (
              <P muted>{fmt(t.web.prices.band, { min: kes(band.min), max: kes(band.max) })}</P>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** One opening range per day, typed as HH:MM (the API also accepts two). */
export function HoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: WorkingHours;
  onChange: (v: WorkingHours) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  return (
    <View style={{ gap: space.sm }}>
      {WEEKDAYS.map((d) => {
        const range = value[d]?.[0];
        const set = (next: { from: string; to: string } | null) =>
          onChange({ ...value, [d]: next ? [next, ...(value[d]?.slice(1) ?? [])] : [] });
        return (
          <View key={d} style={s.row}>
            <Switch
              value={!!range}
              disabled={disabled}
              onValueChange={(on) => set(on ? { from: '08:00', to: '17:00' } : null)}
              trackColor={{ true: colors.brand }}
              accessibilityLabel={t.web.hours.days[d]}
            />
            <Text style={{ width: 96, fontSize: fontSize.md }}>{t.web.hours.days[d]}</Text>
            {range ? (
              <>
                <TextInput
                  accessibilityLabel={`${t.web.hours.days[d]} ${t.web.hours.from}`}
                  style={[input, { width: 80 }]}
                  value={range.from}
                  maxLength={5}
                  editable={!disabled}
                  onChangeText={(x) => set({ ...range, from: x })}
                />
                <Text>–</Text>
                <TextInput
                  accessibilityLabel={`${t.web.hours.days[d]} ${t.web.hours.to}`}
                  style={[input, { width: 80 }]}
                  value={range.to}
                  maxLength={5}
                  editable={!disabled}
                  onChangeText={(x) => set({ ...range, to: x })}
                />
              </>
            ) : (
              <P muted>{t.web.hours.closed}</P>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Row({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  const { t, fmt } = useT();
  const style: TextStyle = {
    fontSize: fontSize.md,
    color: colors.ink,
    fontWeight: strong ? '700' : '400',
  };
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
      <Text style={[style, { flex: 1 }]}>{label}</Text>
      <Text style={style}>{fmt(t.web.common.kes, { amount: kes(amount) })}</Text>
    </View>
  );
}

/** One vet's price: the lines, the total, and who is paid what (§24.3, §24.24). */
export function PriceLines({ price, forVet }: { price: PriceBreakdown; forVet?: boolean }) {
  const { t, fmt } = useT();
  const p = t.web.prices;
  return (
    <View style={{ gap: space.xs }}>
      <Row label={p.consultation} amount={price.consultation} />
      {price.services.map((x) => (
        <Row key={x.service} label={t.web.application.services[x.service]} amount={x.fee} />
      ))}
      {price.callOut > 0 && <Row label={p.callOut} amount={price.callOut} />}
      <Row label={fmt(p.total, { amount: kes(price.total) })} amount={price.total} strong />
      {forVet ? (
        <>
          <Row label={p.collect} amount={price.payVet} strong />
          <P muted>{fmt(p.bookingFeeIncluded, { fee: kes(price.bookingFee) })}</P>
        </>
      ) : (
        <>
          <Row label={p.bookingFeeNow} amount={price.bookingFee} />
          <Row label={p.payVetOnFarm} amount={price.payVet} />
        </>
      )}
      <P muted>{p.startingPrice}</P>
    </View>
  );
}

/** Before a vet accepts: the spread of nearby vets' totals. */
export function PriceRangeLines({
  range,
  bookingFee,
}: {
  range: PriceRange | null;
  bookingFee: number;
}) {
  const { t, fmt } = useT();
  const p = t.web.prices;
  return (
    <View style={{ gap: space.xs }}>
      {range ? (
        <>
          <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.ink }}>
            {range.min === range.max
              ? fmt(p.total, { amount: kes(range.min) })
              : fmt(p.range, { min: kes(range.min), max: kes(range.max) })}
          </Text>
          <P muted>{fmt(p.fromVets, { n: range.vets })}</P>
        </>
      ) : (
        <P>{p.noPriceYet}</P>
      )}
      <Row label={p.bookingFeeNow} amount={bookingFee} />
      <P muted>{p.startingPrice}</P>
    </View>
  );
}

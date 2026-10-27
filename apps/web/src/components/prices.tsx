'use client';

import {
  WEEKDAYS,
  type PriceBreakdown,
  type PriceRange,
  type VetService,
  type WorkingHours,
} from '@vetlink/shared';
import { useT } from '@/lib/i18n';
import { Input } from './ui';

type Band = { min: number; max: number };
const kes = (n: number) => n.toLocaleString('en-KE');

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
    <div className="space-y-2">
      {services.map((s) => {
        const band = bands?.[s];
        return (
          <label key={s} className="flex flex-wrap items-center gap-3">
            <span className="min-w-40 flex-1 font-semibold">{t.web.application.services[s]}</span>
            <span className="text-muted">KES</span>
            <Input
              className="w-32"
              type="number"
              inputMode="numeric"
              min={band?.min ?? 0}
              max={band?.max}
              disabled={disabled}
              value={value[s] ?? ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  ...(e.target.value === ''
                    ? { [s]: undefined }
                    : { [s]: Math.max(0, Math.round(Number(e.target.value))) }),
                })
              }
            />
            {band && (
              <span className="w-full text-sm text-muted">
                {fmt(t.web.prices.band, { min: kes(band.min), max: kes(band.max) })}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** One opening range per day (the API also accepts two). */
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
    <div className="space-y-2">
      {WEEKDAYS.map((d) => {
        const range = value[d]?.[0];
        const set = (next: { from: string; to: string } | null) =>
          onChange({ ...value, [d]: next ? [next, ...(value[d]?.slice(1) ?? [])] : [] });
        return (
          <div key={d} className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-touch min-w-36 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={!!range}
                disabled={disabled}
                onChange={(e) => set(e.target.checked ? { from: '08:00', to: '17:00' } : null)}
              />
              {t.web.hours.days[d]}
            </label>
            {range ? (
              <>
                <Input
                  type="time"
                  aria-label={`${t.web.hours.days[d]} ${t.web.hours.from}`}
                  className="w-32"
                  value={range.from}
                  disabled={disabled}
                  onChange={(e) => set({ ...range, from: e.target.value })}
                />
                <span>–</span>
                <Input
                  type="time"
                  aria-label={`${t.web.hours.days[d]} ${t.web.hours.to}`}
                  className="w-32"
                  value={range.to}
                  disabled={disabled}
                  onChange={(e) => set({ ...range, to: e.target.value })}
                />
              </>
            ) : (
              <span className="text-muted">{t.web.hours.closed}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One vet's price: the lines, the total, and who is paid what (§24.3, §24.24). */
export function PriceLines({ price, forVet }: { price: PriceBreakdown; forVet?: boolean }) {
  const { t, fmt } = useT();
  const p = t.web.prices;
  const row = (label: string, amount: number, strong = false) => (
    <div className={`flex justify-between gap-4 ${strong ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span>{fmt(t.web.common.kes, { amount: kes(amount) })}</span>
    </div>
  );
  return (
    <div className="space-y-1">
      {row(p.consultation, price.consultation)}
      {price.services.map((s) => (
        <div key={s.service}>{row(t.web.application.services[s.service], s.fee)}</div>
      ))}
      {price.callOut > 0 && row(p.callOut, price.callOut)}
      <div className="border-t border-line pt-1">
        {row(fmt(p.total, { amount: kes(price.total) }), price.total, true)}
      </div>
      {forVet ? (
        <>
          {row(p.collect, price.payVet, true)}
          <p className="text-sm text-muted">
            {fmt(p.bookingFeeIncluded, { fee: kes(price.bookingFee) })}
          </p>
        </>
      ) : (
        <>
          {row(p.bookingFeeNow, price.bookingFee)}
          {row(p.payVetOnFarm, price.payVet)}
        </>
      )}
      <p className="text-sm text-muted">{p.startingPrice}</p>
    </div>
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
    <div className="space-y-1">
      {range ? (
        <>
          <p className="text-lg font-bold">
            {range.min === range.max
              ? fmt(p.total, { amount: kes(range.min) })
              : fmt(p.range, { min: kes(range.min), max: kes(range.max) })}
          </p>
          <p className="text-sm text-muted">{fmt(p.fromVets, { n: range.vets })}</p>
        </>
      ) : (
        <p>{p.noPriceYet}</p>
      )}
      <div className="flex justify-between gap-4">
        <span>{p.bookingFeeNow}</span>
        <span>{fmt(t.web.common.kes, { amount: kes(bookingFee) })}</span>
      </div>
      <p className="text-sm text-muted">{p.startingPrice}</p>
    </div>
  );
}

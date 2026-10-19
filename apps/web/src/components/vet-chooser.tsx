'use client';

import { useState } from 'react';
import type { Schemas } from '@vetlink/api-client';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PersonAvatar } from './pictures';
import { PriceLines } from './prices';
import { BadgeChips } from './ratings';
import { ChoiceGrid } from './ui';

export type VetSort = 'distance' | 'rating' | 'price';
type Vet = Schemas['ChoosableVet'];

const kes = (n: number) => n.toLocaleString('en-KE');

/** One vet the farmer can choose (§24.6): photo, verified name, badges, distance, price. */
function VetCardRow({
  vet,
  selected,
  onSelect,
}: {
  vet: Vet;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, fmt } = useT();
  const { api } = useSession();
  const [card, setCard] = useState<Schemas['VetCard'] | null>(null);
  const c = t.web.choose;
  return (
    <li
      className={`rounded-card border p-3 ${selected ? 'border-brand bg-brand-light' : 'border-line bg-surface'}`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex w-full items-start gap-3 text-left"
      >
        <PersonAvatar url={vet.photoUrl} name={vet.name} size={56} />
        <span className="flex-1 space-y-1">
          <span className="block font-bold">{vet.name ?? '-'}</span>
          {vet.displayName && <span className="block text-muted">“{vet.displayName}”</span>}
          <span className="block text-sm">
            {vet.type === 'vet' ? t.web.onboarding.vetTypeVet : t.web.onboarding.vetTypeParavet}
            {' · '}
            {vet.rating === null ? c.newVet : `★ ${vet.rating.toFixed(1)}`}
            {' · '}
            {vet.distanceKm === 0 ? c.underKm : fmt(c.km, { km: vet.distanceKm })}
          </span>
          <BadgeChips badges={vet.badges} />
        </span>
        <span className="text-right font-bold">
          {fmt(t.web.prices.total, { amount: kes(vet.price.total) })}
        </span>
      </button>
      <button
        type="button"
        className="mt-2 text-sm underline"
        onClick={async () => {
          if (card) return setCard(null);
          const { data } = await api.GET('/v1/vets/{vetId}/card', {
            params: { path: { vetId: vet.vetId } },
          });
          setCard(data ?? null);
        }}
      >
        {c.viewProfile}
      </button>
      {card && (
        <div className="mt-2 space-y-2 border-t border-line pt-2 text-sm">
          {card.bio && <p className="italic">{card.bio}</p>}
          <p>{card.species.map((s) => t.ussd.species[s]).join(', ')}</p>
          {card.yearsExperience !== null && (
            <p>
              {t.web.application.fields.yearsExperience}: {card.yearsExperience}
            </p>
          )}
          <PriceLines price={vet.price} />
        </div>
      )}
    </li>
  );
}

/**
 * The "choose a vet" list (§24.6): "fastest available" first, then up to 20 vets with their
 * price for this request. `value` is a vet id, or 'auto' for fastest available.
 */
export function VetChooser({
  vets,
  value,
  onChange,
  sort,
  onSort,
  showFastest = true,
}: {
  vets: Vet[] | null;
  value: string | null;
  onChange: (v: string) => void;
  sort: VetSort;
  onSort: (s: VetSort) => void;
  showFastest?: boolean;
}) {
  const { t } = useT();
  const c = t.web.choose;
  return (
    <div className="space-y-3">
      {showFastest && (
        <button
          type="button"
          aria-pressed={value === 'auto'}
          onClick={() => onChange('auto')}
          className={`w-full rounded-card border p-3 text-left ${value === 'auto' ? 'border-brand bg-brand-light' : 'border-line bg-surface'}`}
        >
          <span className="block font-bold">⚡ {c.fastest}</span>
          <span className="block text-sm text-muted">{c.fastestHint}</span>
        </button>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold">{c.sortBy}</p>
        <ChoiceGrid
          options={(['distance', 'rating', 'price'] as const).map((s) => ({
            value: s,
            label: c.sort[s],
          }))}
          value={sort}
          onChange={onSort}
        />
      </div>
      {vets === null ? (
        <p>…</p>
      ) : vets.length === 0 ? (
        <p className="text-muted">{c.empty}</p>
      ) : (
        <ul className="space-y-2">
          {vets.map((v) => (
            <VetCardRow
              key={v.vetId}
              vet={v}
              selected={value === v.vetId}
              onSelect={() => onChange(v.vetId)}
            />
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">{c.feeAfterAccept}</p>
    </div>
  );
}

/** Clinics a farmer can take the animal to (§24.3), with a directions link. */
export function ClinicList({ clinics }: { clinics: Schemas['Clinic'][] }) {
  const { t, fmt } = useT();
  const c = t.web.choose;
  if (clinics.length === 0) return null;
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-bold">{c.clinicsTitle}</h2>
      <p className="text-sm text-muted">{c.clinicsHint}</p>
      <ul className="divide-y divide-line">
        {clinics.map((x) => (
          <li key={x.vetId} className="flex items-center gap-3 py-2">
            <PersonAvatar url={x.photoUrl} name={x.name} size={40} />
            <span className="flex-1">
              <span className="block font-semibold">{x.name ?? '-'}</span>
              <span className="block text-sm text-muted">
                {x.ward} · {x.distanceKm === 0 ? c.underKm : fmt(c.km, { km: x.distanceKm })}
                {x.hours && ` · ${x.hours}`}
              </span>
              {x.directions && <span className="block text-sm">{x.directions}</span>}
            </span>
            <a
              className="text-sm underline"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://www.google.com/maps/dir/?api=1&destination=${x.location.lat},${x.location.lng}`}
            >
              {c.directions}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

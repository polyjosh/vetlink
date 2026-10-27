'use client';

import { ratingTagsFor, type RatingTag, type VetBadge } from '@vetlink/shared';
import { useT } from '@/lib/i18n';

/** Tap-to-pick rating chips (§24.7), chosen by the stars given. */
export function TagChips({
  stars,
  value,
  onChange,
}: {
  stars: number;
  value: RatingTag[];
  onChange: (v: RatingTag[]) => void;
}) {
  const { t } = useT();
  if (!stars) return null;
  const options = ratingTagsFor(stars);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">
        {stars <= 2 ? t.web.ratings.tagsPromptLow : t.web.ratings.tagsPrompt}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((tag) => {
          const on = value.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== tag) : [...value, tag])}
              className={`min-h-touch rounded-full border px-3 ${on ? 'border-brand bg-brand-light font-semibold' : 'border-line'}`}
            >
              {t.web.ratings.tags[tag]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Server-computed badges (§24.8). */
export function BadgeChips({ badges }: { badges: readonly VetBadge[] }) {
  const { t } = useT();
  if (badges.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <li
          key={b}
          className="rounded-full bg-brand-light px-2 py-0.5 text-sm font-semibold text-brand-dark"
        >
          {b === 'verified' ? '✓ ' : ''}
          {t.web.badges[b]}
        </li>
      ))}
    </ul>
  );
}

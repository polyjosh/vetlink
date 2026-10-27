'use client';

import { useState } from 'react';
import type { Species } from '@vetlink/shared';
import {
  ILLUSTRATION_VIEWBOX,
  emptyStateIllustrations,
  resolveFill,
  speciesIllustrations,
  type Illustration,
} from '@vetlink/ui-tokens';
import { useT } from '@/lib/i18n';

/** A flat illustration from @vetlink/ui-tokens as inline SVG (§24.2). */
export function IllustrationSvg({
  art,
  label,
  size,
}: {
  art: Illustration;
  label: string;
  size: number;
}) {
  const theme = 'light'; // dark mode arrives with the UI pass (§24.13)
  return (
    <svg viewBox={ILLUSTRATION_VIEWBOX} width={size} height={size} role="img" aria-label={label}>
      {art.shapes.map((s, i) => {
        if (s.type === 'circle') {
          return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={resolveFill(s.fill, theme)} />;
        }
        if (s.type === 'ellipse') {
          return (
            <ellipse
              key={i}
              cx={s.cx}
              cy={s.cy}
              rx={s.rx}
              ry={s.ry}
              fill={resolveFill(s.fill, theme)}
            />
          );
        }
        return (
          <path
            key={i}
            d={s.d}
            fill={s.fill ? resolveFill(s.fill, theme) : 'none'}
            stroke={s.stroke ? resolveFill(s.stroke, theme) : undefined}
            strokeWidth={s.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

/** A remote photo that falls back when missing or when its signed link has expired. */
function Photo({
  url,
  alt,
  size,
  fallback,
}: {
  url: string | null | undefined;
  alt: string;
  size: number;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <>{fallback}</>;
  return (
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(url)}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  );
}

/** An animal's photo, or the picture of its species. */
export function AnimalPicture({
  url,
  species,
  size = 48,
}: {
  url: string | null | undefined;
  species: Species;
  size?: number;
}) {
  const { t } = useT();
  const label = t.ussd.species[species];
  return (
    <Photo
      url={url}
      alt={label}
      size={size}
      fallback={<IllustrationSvg art={speciesIllustrations[species]} label={label} size={size} />}
    />
  );
}

/** A person's photo, or their initials. */
export function PersonAvatar({
  url,
  name,
  size = 48,
}: {
  url: string | null | undefined;
  name: string | null | undefined;
  size?: number;
}) {
  const initials =
    (name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';
  return (
    <Photo
      url={url}
      alt={name ?? ''}
      size={size}
      fallback={
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-light font-bold text-brand"
          style={{ width: size, height: size, fontSize: size / 2.6 }}
        >
          {initials}
        </span>
      }
    />
  );
}

/** Illustration, one line of text, and an optional action (§24.13). */
export function EmptyState({
  kind,
  text,
  action,
}: {
  kind: keyof typeof emptyStateIllustrations;
  text: string;
  action?: React.ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <IllustrationSvg art={emptyStateIllustrations[kind]} label={t.web.empty[kind]} size={96} />
      <p className="text-muted">{text}</p>
      {action}
    </div>
  );
}

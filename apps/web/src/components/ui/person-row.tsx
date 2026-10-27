'use client';

import type { ReactNode } from 'react';
import { size } from '@vetlink/ui-tokens';
import { useT } from '@/lib/i18n';
import { PersonAvatar } from '../pictures';
import { Icon } from './icon';

/** A person with a photo or initials, name, optional verified mark, meta line and call button. */
export function PersonRow({
  name,
  photoUrl,
  meta,
  verified,
  phone,
  trailing,
}: {
  name: string;
  photoUrl?: string | null | undefined;
  meta?: ReactNode;
  verified?: boolean;
  phone?: string | null | undefined;
  trailing?: ReactNode;
}) {
  const { t, fmt } = useT();
  return (
    <div className="flex items-center gap-4">
      <PersonAvatar url={photoUrl} name={name} size={size.avatar} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-heading">{name}</span>
          {verified && (
            <span className="text-primary">
              <Icon name="shieldCheck" size={size.iconSm} label={t.web.ui.verifiedVet} />
            </span>
          )}
        </div>
        {meta && <div className="mt-0.5 text-small text-ink-muted">{meta}</div>}
      </div>
      {phone && (
        <a
          href={`tel:+${phone.replace(/^\+/, '')}`}
          aria-label={fmt(t.web.ui.callPerson, { name })}
          className="flex size-avatar shrink-0 items-center justify-center rounded-md bg-primary text-on-primary hover:bg-primary-pressed"
        >
          <Icon name="phone" />
        </a>
      )}
      {trailing}
    </div>
  );
}

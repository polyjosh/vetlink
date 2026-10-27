import Link from 'next/link';
import { ICON_STROKE, ICON_VIEWBOX, logoMark, size } from '@vetlink/ui-tokens';

/** The VetLink mark and wordmark. `boxed` puts the mark on a primary tile (light headers). */
export function Logo({ boxed = true, label = 'VetLink' }: { boxed?: boolean; label?: string }) {
  const mark = (
    <svg
      viewBox={ICON_VIEWBOX}
      width={size.icon}
      height={size.icon}
      fill="none"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={logoMark.pin} className="stroke-accent" />
      <path d={logoMark.cross} className="stroke-on-primary" />
    </svg>
  );
  return (
    <Link href="/" className="flex min-h-touch items-center gap-2.5 text-heading font-extrabold">
      {boxed ? (
        <span className="flex size-10 items-center justify-center rounded-md bg-primary">
          {mark}
        </span>
      ) : (
        mark
      )}
      <span>{label}</span>
    </Link>
  );
}

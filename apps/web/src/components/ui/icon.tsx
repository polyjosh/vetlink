import { ICON_STROKE, ICON_VIEWBOX, icons, size as sizes, type IconName } from '@vetlink/ui-tokens';

/**
 * A stroke icon from @vetlink/ui-tokens. Decorative by default (hidden from screen readers);
 * pass `label` when the icon is the only content of a control.
 */
export function Icon({
  name,
  size = sizes.icon,
  label,
  className = '',
}: {
  name: IconName;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox={ICON_VIEWBOX}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {icons[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

import Svg, { Path } from 'react-native-svg';
import {
  ICON_STROKE,
  ICON_VIEWBOX,
  color as palette,
  icons,
  logoMark,
  size as sizes,
  space,
  type IconName,
} from '@vetlink/ui-tokens';

/**
 * A stroke icon from @vetlink/ui-tokens. Decorative unless `label` is given (then it is announced
 * as an image); icon-only buttons put their label on the button instead.
 */
export function Icon({
  name,
  size = sizes.icon,
  color = palette.ink,
  label,
}: {
  name: IconName;
  size?: number;
  color?: string;
  label?: string;
}) {
  return (
    <Svg
      viewBox={ICON_VIEWBOX}
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label
        ? { accessible: true, accessibilityLabel: label, accessibilityRole: 'image' as const }
        : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const })}
    >
      {icons[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

/** The VetLink mark: a map pin in `accent` with a cross in `crossColor`. */
export function LogoMark({ crossColor = palette.onPrimary }: { crossColor?: string }) {
  return (
    <Svg
      viewBox={ICON_VIEWBOX}
      width={sizes.icon + space[1]}
      height={sizes.icon + space[1]}
      fill="none"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
    >
      <Path d={logoMark.pin} stroke={palette.accent} />
      <Path d={logoMark.cross} stroke={crossColor} />
    </Svg>
  );
}

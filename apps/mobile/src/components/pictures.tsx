import { useState, type ReactNode } from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import type { Species } from '@vetlink/shared';
import {
  ILLUSTRATION_VIEWBOX,
  colors,
  emptyStateIllustrations,
  resolveFill,
  space,
  speciesIllustrations,
  type Illustration,
} from '@vetlink/ui-tokens';
import { useT } from '../lib/i18n';
import { P } from './ui';

/** A flat illustration from @vetlink/ui-tokens (§24.2), the same one the web draws. */
export function IllustrationView({
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
    <Svg
      viewBox={ILLUSTRATION_VIEWBOX}
      width={size}
      height={size}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {art.shapes.map((sh, i) => {
        if (sh.type === 'circle') {
          return (
            <Circle key={i} cx={sh.cx} cy={sh.cy} r={sh.r} fill={resolveFill(sh.fill, theme)} />
          );
        }
        if (sh.type === 'ellipse') {
          return (
            <Ellipse
              key={i}
              cx={sh.cx}
              cy={sh.cy}
              rx={sh.rx}
              ry={sh.ry}
              fill={resolveFill(sh.fill, theme)}
            />
          );
        }
        return (
          <Path
            key={i}
            d={sh.d}
            fill={sh.fill ? resolveFill(sh.fill, theme) : 'none'}
            {...(sh.stroke && {
              stroke: resolveFill(sh.stroke, theme),
              strokeWidth: sh.strokeWidth ?? 1,
              strokeLinecap: 'round' as const,
              strokeLinejoin: 'round' as const,
            })}
          />
        );
      })}
    </Svg>
  );
}

/** A remote photo that falls back when missing or when its signed link has expired. */
function Photo({
  url,
  label,
  size,
  fallback,
}: {
  url: string | null | undefined;
  label: string;
  size: number;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <>{fallback}</>;
  return (
    <Image
      source={{ uri: url }}
      accessibilityLabel={label}
      onError={() => setFailed(url)}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}

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
      label={label}
      size={size}
      fallback={<IllustrationView art={speciesIllustrations[species]} label={label} size={size} />}
    />
  );
}

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
      label={name ?? ''}
      size={size}
      fallback={
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.brandLight,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.brand, fontWeight: '700', fontSize: size / 2.6 }}>
            {initials}
          </Text>
        </View>
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
  action?: ReactNode;
}) {
  const { t } = useT();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
      <IllustrationView art={emptyStateIllustrations[kind]} label={t.web.empty[kind]} size={96} />
      <P muted>{text}</P>
      {action}
    </View>
  );
}

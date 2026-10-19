import { Text, View } from 'react-native';
import { ratingTagsFor, type RatingTag, type VetBadge } from '@vetlink/shared';
import { colors, fontSize, radius, space } from '@vetlink/ui-tokens';
import { useT } from '../lib/i18n';
import { Choices, P } from './ui';

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
  return (
    <View style={{ gap: space.xs }}>
      <P muted>{stars <= 2 ? t.web.ratings.tagsPromptLow : t.web.ratings.tagsPrompt}</P>
      <Choices
        multi
        options={ratingTagsFor(stars).map((tag) => ({
          value: tag,
          label: t.web.ratings.tags[tag],
        }))}
        value={value}
        onChange={(tag) =>
          onChange(value.includes(tag) ? value.filter((x) => x !== tag) : [...value, tag])
        }
      />
    </View>
  );
}

/** Server-computed badges (§24.8). */
export function BadgeChips({ badges }: { badges: readonly VetBadge[] }) {
  const { t } = useT();
  if (badges.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
      {badges.map((b) => (
        <Text
          key={b}
          style={{
            backgroundColor: colors.brandLight,
            color: colors.brandDark,
            borderRadius: radius.pill,
            paddingHorizontal: space.sm,
            fontSize: fontSize.sm,
            fontWeight: '700',
          }}
        >
          {`${b === 'verified' ? '✓ ' : ''}${t.web.badges[b]}`}
        </Text>
      ))}
    </View>
  );
}

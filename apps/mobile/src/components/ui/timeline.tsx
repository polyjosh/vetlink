import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { color, radius, size, space, type } from '@vetlink/ui-tokens';
import { useT } from '../../lib/i18n';
import { Icon } from './icon';
import { Text } from './text';

export type TimelineState = 'done' | 'current' | 'upcoming';

const DOT = size.icon + space[1];

/** Vertical step list: done (filled primary with a check), current (info ring), upcoming (grey). */
export function Timeline({
  steps,
}: {
  steps: { key: string; label: string; meta?: ReactNode; state: TimelineState }[];
}) {
  const { t } = useT();
  const sr = {
    done: t.web.ui.stepDone,
    current: t.web.ui.stepNow,
    upcoming: t.web.ui.stepUpcoming,
  };
  return (
    <View>
      {steps.map((st, i) => (
        <View
          key={st.key}
          style={s.step}
          accessible
          accessibilityLabel={`${sr[st.state]}: ${st.label}`}
        >
          <View style={s.rail}>
            <View
              style={[s.dot, st.state === 'done' && s.dotDone, st.state === 'current' && s.dotNow]}
            >
              {st.state === 'done' ? <Icon name="check" size={16} color={color.onPrimary} /> : null}
            </View>
            {i < steps.length - 1 ? (
              <View style={[s.line, st.state === 'done' && { backgroundColor: color.primary }]} />
            ) : null}
          </View>
          <View style={s.text}>
            <Text
              style={[
                s.label,
                st.state === 'upcoming' && { color: color.inkMuted },
                st.state === 'current' && { fontWeight: '700', color: color.info },
              ]}
            >
              {st.label}
            </Text>
            {st.meta ? <Text style={s.meta}>{st.meta}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  step: { flexDirection: 'row', gap: space[3] },
  rail: { alignItems: 'center', width: DOT },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.pill,
    borderWidth: size.borderTile,
    borderColor: color.border,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: color.primary, borderColor: color.primary },
  dotNow: { borderColor: color.info, backgroundColor: color.infoSoft, borderWidth: 3 },
  line: { width: 2, flex: 1, minHeight: space[4], backgroundColor: color.border },
  text: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space[2],
    paddingTop: space[1],
    paddingBottom: space[4],
  },
  label: { fontWeight: '600' },
  meta: { fontSize: type.small.size, lineHeight: type.body.line, color: color.inkMuted },
});

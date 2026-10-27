/**
 * Shared mobile components (design system v1, docs/design/project/Main.dc.html). Big,
 * high-contrast controls for low-end phones in bright sun (§11).
 */
import { StyleSheet } from 'react-native';
import { color, space, type } from '@vetlink/ui-tokens';

export * from './bottom-nav';
export * from './button';
export * from './choices';
export * from './feedback';
export * from './form';
export * from './icon';
export * from './language-toggle';
export * from './person-row';
export * from './text';
export * from './timeline';

/** Layout helpers screens share. */
export const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' },
  muted: { fontSize: type.small.size, lineHeight: type.small.line, color: color.inkMuted },
});

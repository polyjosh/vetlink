import { Figtree_400Regular } from '@expo-google-fonts/figtree/400Regular';
import { Figtree_500Medium } from '@expo-google-fonts/figtree/500Medium';
import { Figtree_600SemiBold } from '@expo-google-fonts/figtree/600SemiBold';
import { Figtree_700Bold } from '@expo-google-fonts/figtree/700Bold';
import { Figtree_800ExtraBold } from '@expo-google-fonts/figtree/800ExtraBold';
import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';
import { color, type } from '@vetlink/ui-tokens';

/** Figtree faces bundled with the app (one file per weight; Android cannot synthesize them). */
export const FONT_FILES = {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
};

const FACE: Record<string, keyof typeof FONT_FILES> = {
  '400': 'Figtree_400Regular',
  normal: 'Figtree_400Regular',
  '500': 'Figtree_500Medium',
  '600': 'Figtree_600SemiBold',
  '700': 'Figtree_700Bold',
  bold: 'Figtree_700Bold',
  '800': 'Figtree_800ExtraBold',
  '900': 'Figtree_800ExtraBold',
};

// Set once by the root layout before anything renders. If the fonts fail to load, text keeps
// the system font with its normal weights, and every layout still works.
let fontsLoaded = false;
export function setFontsLoaded(loaded: boolean): void {
  fontsLoaded = loaded;
}

const base = { color: color.ink, fontSize: type.body.size } as const;

/** All app text: body size and ink by default, mapped to the Figtree face for its weight. */
export function Text({ style, ...props }: TextProps) {
  if (!fontsLoaded) return <RNText {...props} style={[base, style]} />;
  const flat: TextStyle = StyleSheet.flatten([base, style]) ?? {};
  const face = FACE[String(flat.fontWeight ?? '400')] ?? 'Figtree_400Regular';
  return <RNText {...props} style={[flat, { fontFamily: face, fontWeight: 'normal' }]} />;
}

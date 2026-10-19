import * as Linking from 'expo-linking';
import { Image, Pressable, View } from 'react-native';
import { radius, space } from '@vetlink/ui-tokens';

/** The farmer's photos of the animal (§24.15): thumbnails that open full size. */
export function PhotoStrip({ urls }: { urls: string[] | undefined }) {
  if (!urls?.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {urls.map((u, i) => (
        <Pressable key={u} accessibilityRole="imagebutton" onPress={() => void Linking.openURL(u)}>
          <Image
            source={{ uri: u }}
            accessibilityLabel={`📷 ${i + 1}`}
            style={{ width: 72, height: 72, borderRadius: radius.md }}
          />
        </Pressable>
      ))}
    </View>
  );
}

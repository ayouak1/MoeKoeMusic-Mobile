import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { usePalette } from "@/hooks/use-palette";

type ArtworkProps = {
  uri: string | null | undefined;
  /** 固定边长；不传则铺满父容器（正方形）。 */
  size?: number;
  radius?: number;
  circle?: boolean;
  /** 列表复用场景关闭淡入动画以提升滑动帧率。 */
  instant?: boolean;
};

export const Artwork = memo(function Artwork({
  uri,
  size,
  radius = 14,
  circle = false,
  instant = false,
}: ArtworkProps) {
  const palette = usePalette();
  const frameStyle = size
    ? { width: size, height: size, borderRadius: circle ? size / 2 : radius }
    : { width: "100%" as const, aspectRatio: 1, borderRadius: radius };

  if (!uri) {
    const iconSize = size ? Math.max(16, Math.round(size * 0.38)) : 34;
    return (
      <LinearGradient
        colors={[palette.placeholderStart, palette.placeholderEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.placeholder, frameStyle]}>
        <Ionicons name="musical-notes" size={iconSize} color={palette.textTertiary} />
      </LinearGradient>
    );
  }

  return (
    <View style={[styles.frame, frameStyle, { backgroundColor: palette.cardAlt }]}>
      <Image
        source={{ uri }}
        recyclingKey={uri}
        cachePolicy="memory-disk"
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={instant ? 0 : 180}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});

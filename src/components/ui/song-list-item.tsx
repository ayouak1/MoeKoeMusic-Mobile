import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Artwork } from "@/components/ui/artwork";
import type { PlayerTrack } from "@/features/player/types";
import { usePalette } from "@/hooks/use-palette";
import { formatClock } from "@/lib/format";

type SongListItemProps = {
  track: PlayerTrack;
  active?: boolean;
  rank?: number;
  index?: number;
  onPress?: () => void;
  onPressIndex?: (index: number) => void;
  /** 打开歌曲操作面板(收藏/分享等);同时作为长按行为。 */
  onMore?: () => void;
  onMoreTrack?: (track: PlayerTrack) => void;
};

export const SongListItem = memo(function SongListItem({
  track,
  active = false,
  rank,
  index,
  onPress,
  onPressIndex,
  onMore,
  onMoreTrack,
}: SongListItemProps) {
  const palette = usePalette();

  function handlePress() {
    if (onPressIndex && typeof index === "number") {
      onPressIndex(index);
      return;
    }
    onPress?.();
  }

  function handleMore() {
    if (onMoreTrack) {
      onMoreTrack(track);
      return;
    }
    onMore?.();
  }

  const hasMore = Boolean(onMore || onMoreTrack);

  return (
    <Pressable
      unstable_pressDelay={75}
      onPress={handlePress}
      onLongPress={hasMore ? handleMore : undefined}
      style={({ pressed }) => [
        styles.row,
        active && { backgroundColor: palette.accentSoft },
        pressed && { opacity: 0.7 },
      ]}>
      {typeof rank === "number" ? (
        <Text
          style={[
            styles.rank,
            { color: rank <= 3 ? palette.accent : palette.textTertiary },
          ]}>
          {String(rank).padStart(2, "0")}
        </Text>
      ) : null}

      <Artwork uri={track.coverUrl} size={48} radius={12} instant />

      <View style={styles.meta}>
        <View style={styles.titleRow}>
          <Text
            style={[
              styles.title,
              { color: active ? palette.accent : palette.text },
            ]}
            numberOfLines={1}>
            {track.title}
          </Text>
          {track.quality ? (
            <Text
              style={[
                styles.qualityBadge,
                {
                  color: track.quality === "sq" ? palette.vip : palette.textTertiary,
                  borderColor: track.quality === "sq" ? palette.vip : palette.textTertiary,
                  opacity: track.quality === "sq" ? 1 : 0.85,
                },
              ]}>
              {track.quality.toUpperCase()}
            </Text>
          ) : null}
          {track.vip ? (
            <Text
              style={[
                styles.vipBadge,
                {
                  color: palette.vip,
                  backgroundColor: palette.vipSoft,
                },
              ]}>
              VIP
            </Text>
          ) : null}
        </View>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]} numberOfLines={1}>
          {track.artist || "未知歌手"}
          {track.album ? ` · ${track.album}` : ""}
        </Text>
      </View>

      {active ? (
        <Ionicons name="pulse" size={18} color={palette.accent} />
      ) : track.durationMs ? (
        <Text style={[styles.duration, { color: palette.textTertiary }]}>
          {formatClock(track.durationMs)}
        </Text>
      ) : null}

      {hasMore ? (
        <Pressable
          hitSlop={6}
          onPress={(event) => {
            event.stopPropagation();
            handleMore();
          }}
          style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.5 }]}>
          <Ionicons name="ellipsis-vertical" size={16} color={palette.textTertiary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
  },
  rank: {
    width: 26,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "700",
  },
  meta: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  qualityBadge: {
    fontSize: 8.5,
    fontWeight: "800",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    overflow: "hidden",
  },
  vipBadge: {
    fontSize: 9.5,
    fontWeight: "800",
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 5,
    overflow: "hidden",
  },
  subtitle: {
    fontSize: 12.5,
  },
  duration: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  moreBtn: {
    width: 30,
    height: 34,
    marginLeft: -6,
    alignItems: "center",
    justifyContent: "center",
  },
});

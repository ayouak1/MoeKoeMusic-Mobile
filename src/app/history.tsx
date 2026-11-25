import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, StyleSheet, View as RNView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View, XStack, YStack } from "tamagui";

import { MiniPlayer, MINI_PLAYER_HEIGHT } from "@/components/ui/mini-player";
import { SongListItem } from "@/components/ui/song-list-item";
import { TrackActionsSheet } from "@/components/ui/track-actions-sheet";
import { MaxContentWidth } from "@/constants/theme";
import { playHistoryActions, usePlayHistory } from "@/features/player/history-store";
import { playerActions, useHasTrack, usePlayer } from "@/features/player/store";
import type { PlayerTrack } from "@/features/player/types";
import { useIsDark, usePalette } from "@/hooks/use-palette";

export default function HistoryScreen() {
  const palette = usePalette();
  const isDark = useIsDark();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hasTrack = useHasTrack();
  const { track: activeTrack } = usePlayer();
  const history = usePlayHistory();
  const [actionTrack, setActionTrack] = useState<PlayerTrack | null>(null);

  const tracks = history.map((item) => item.track);
  const bottomInset = Math.max(insets.bottom, 12) + (hasTrack ? MINI_PLAYER_HEIGHT + 24 : 20);

  function confirmClear() {
    Alert.alert("清空历史播放", "确定要清空全部本地播放记录吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "清空",
        style: "destructive",
        onPress: () => playHistoryActions.clear(),
      },
    ]);
  }

  return (
    <View flex={1} backgroundColor={palette.background}>
      <LinearGradient
        colors={[isDark ? "rgba(255, 126, 182, 0.14)" : "rgba(255, 92, 158, 0.12)", "transparent"]}
        style={styles.headerGlow}
      />

      <FlatList
        data={tracks}
        keyExtractor={(item, index) => `${item.hash}-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          alignSelf: "center",
          width: "100%",
          maxWidth: MaxContentWidth,
          paddingTop: insets.top + 10,
          paddingBottom: bottomInset,
          paddingHorizontal: 16,
          gap: 6,
        }}
        ListHeaderComponent={
          <YStack gap={16} paddingBottom={10}>
            <XStack alignItems="center" justifyContent="space-between">
              <XStack
                width={38}
                height={38}
                borderRadius={19}
                alignItems="center"
                justifyContent="center"
                backgroundColor={palette.card}
                borderWidth={StyleSheet.hairlineWidth}
                borderColor={palette.border}
                transition="quickest"
                pressStyle={{ opacity: 0.7, scale: 0.96 }}
                onPress={() => router.back()}>
                <Ionicons name="chevron-back" size={20} color={palette.text} />
              </XStack>

              {tracks.length ? (
                <XStack
                  alignItems="center"
                  gap={5}
                  paddingHorizontal={12}
                  height={34}
                  borderRadius={17}
                  backgroundColor={palette.card}
                  borderWidth={StyleSheet.hairlineWidth}
                  borderColor={palette.border}
                  pressStyle={{ opacity: 0.7 }}
                  onPress={confirmClear}>
                  <Ionicons name="trash-outline" size={14} color={palette.textSecondary} />
                  <Text color={palette.textSecondary} fontSize={12.5} fontWeight="600">
                    清空
                  </Text>
                </XStack>
              ) : null}
            </XStack>

            <XStack gap={16} alignItems="center">
              <XStack
                width={96}
                height={96}
                borderRadius={20}
                overflow="hidden"
                alignItems="center"
                justifyContent="center">
                <LinearGradient
                  colors={["#7C6BFF", "#5B4CE8"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <Ionicons name="time" size={40} color="#FFFFFF" />
              </XStack>
              <YStack flex={1} gap={6}>
                <Text color={palette.text} fontSize={22} fontWeight="800">
                  最近播放
                </Text>
                <Text color={palette.textTertiary} fontSize={13}>
                  {tracks.length ? `共 ${tracks.length} 首（最多保留最近 100 首）` : "暂无本地播放记录"}
                </Text>
                {tracks.length ? (
                  <XStack
                    alignSelf="flex-start"
                    alignItems="center"
                    gap={7}
                    height={38}
                    marginTop={2}
                    paddingHorizontal={18}
                    borderRadius={19}
                    backgroundColor={palette.accent}
                    transition="quickest"
                    pressStyle={{ opacity: 0.85, scale: 0.97 }}
                    onPress={() => void playerActions.playTracks(tracks, 0)}>
                    <Ionicons name="play" size={15} color={palette.onAccent} />
                    <Text color={palette.onAccent} fontSize={13.5} fontWeight="700">
                      播放全部
                    </Text>
                  </XStack>
                ) : null}
              </YStack>
            </XStack>
          </YStack>
        }
        ListEmptyComponent={
          <YStack alignItems="center" paddingVertical={70} gap={10}>
            <Ionicons name="musical-notes-outline" size={38} color={palette.textTertiary} />
            <Text color={palette.textTertiary} fontSize={13.5}>
              去听几首歌，这里会自动记录你的播放足迹
            </Text>
          </YStack>
        }
        renderItem={({ item, index }) => (
          <SongListItem
            track={item}
            rank={index + 1}
            active={item.hash === activeTrack?.hash}
            onPress={() => void playerActions.playTracks(tracks, index)}
            onMore={() => setActionTrack(item)}
          />
        )}
      />

      <TrackActionsSheet
        open={Boolean(actionTrack)}
        onOpenChange={(open) => {
          if (!open) {
            setActionTrack(null);
          }
        }}
        track={actionTrack}
      />

      <RNView
        pointerEvents="box-none"
        style={[styles.miniDock, { bottom: Math.max(insets.bottom, 12) }]}>
        <RNView pointerEvents="box-none" style={styles.miniDockInner}>
          <MiniPlayer />
        </RNView>
      </RNView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 280,
  },
  miniDock: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  miniDockInner: {
    width: "100%",
    maxWidth: 780,
  },
});

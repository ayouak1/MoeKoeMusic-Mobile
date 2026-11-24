import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  FlatList,
  InteractionManager,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Slider, Spinner, Text, View, XStack, YStack } from "tamagui";

import { Artwork } from "@/components/ui/artwork";
import { LyricsView } from "@/components/ui/lyrics-view";
import { QueueSheet } from "@/components/ui/queue-sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { showToast, ToastHost } from "@/components/ui/toast";
import { TrackActionsSheet } from "@/components/ui/track-actions-sheet";
import { libraryActions, useIsLiked } from "@/features/library/store";
import { playerActions, usePlayer, usePlayerProgress } from "@/features/player/store";
import type { PlayMode } from "@/features/player/types";
import { useIsDark, usePalette } from "@/hooks/use-palette";
import { formatClock } from "@/lib/format";
import { shareTrack } from "@/lib/share";

const MODE_ICON: Record<PlayMode, "repeat" | "repeat-once" | "shuffle-variant"> = {
  sequence: "repeat",
  shuffle: "shuffle-variant",
  single: "repeat-once",
};

const RIGHT_PANE_OPTIONS = [
  { value: "lyrics", label: "实时歌词" },
  { value: "queue", label: "播放队列" },
] as const;

type RightPaneTab = (typeof RIGHT_PANE_OPTIONS)[number]["value"];

function SpinningDisc({
  coverUrl,
  playing,
  size,
}: {
  coverUrl: string | null;
  playing: boolean;
  size: number;
}) {
  const isDark = useIsDark();
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (playing) {
      rotation.value = withRepeat(
        withTiming(rotation.value + 360, { duration: 24000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      cancelAnimation(rotation);
    }
  }, [playing, rotation]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value % 360}deg` }],
  }));

  return (
    <YStack
      width={size}
      height={size}
      borderRadius={size / 2}
      alignItems="center"
      justifyContent="center"
      backgroundColor={isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 0.75)"}
      shadowColor="#000000"
      shadowOffset={{ width: 0, height: 18 }}
      shadowOpacity={isDark ? 0.5 : 0.18}
      shadowRadius={30}
      elevation={16}>
      <Animated.View style={spinStyle}>
        <Artwork uri={coverUrl} size={Math.max(120, size - 26)} circle />
      </Animated.View>
    </YStack>
  );
}

function PlaybackProgress() {
  const palette = usePalette();
  const { positionMs, durationMs } = usePlayerProgress();
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragValueRef = useRef<number | null>(null);
  const shownPosition = dragValue ?? positionMs;

  return (
    <YStack gap={7}>
      <Slider
        size="$2"
        value={[Math.min(shownPosition, Math.max(durationMs, 1))]}
        max={Math.max(durationMs, 1)}
        step={250}
        disabled={!durationMs}
        onValueChange={(values) => {
          const next = values[0] ?? 0;
          dragValueRef.current = next;
          setDragValue(next);
        }}
        onSlideEnd={() => {
          if (dragValueRef.current !== null) {
            playerActions.seekToMs(dragValueRef.current);
          }
          dragValueRef.current = null;
          setTimeout(() => setDragValue(null), 180);
        }}>
        <Slider.Track backgroundColor={palette.cardAlt} height={4} borderRadius={999}>
          <Slider.TrackActive backgroundColor={palette.accent} />
        </Slider.Track>
        <Slider.Thumb
          index={0}
          size={16}
          circular
          backgroundColor={palette.accent}
          borderWidth={2.5}
          borderColor="#FFFFFF"
          pressStyle={{
            scale: 1.2,
            backgroundColor: palette.accentPressed,
            borderColor: "#FFFFFF",
          }}
          hoverStyle={{ backgroundColor: palette.accent, borderColor: "#FFFFFF" }}
          shadowColor="#000000"
          shadowOpacity={0.2}
          shadowRadius={5}
          shadowOffset={{ width: 0, height: 2 }}
        />
      </Slider>
      <XStack justifyContent="space-between">
        <Text color={palette.textTertiary} fontSize={11} fontVariant={["tabular-nums"]}>
          {formatClock(shownPosition)}
        </Text>
        <Text color={palette.textTertiary} fontSize={11} fontVariant={["tabular-nums"]}>
          {formatClock(durationMs)}
        </Text>
      </XStack>
    </YStack>
  );
}

export default function PlayerScreen() {
  const palette = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const windowDims = useWindowDimensions();
  const player = usePlayer();

  const [containerSize, setContainerSize] = useState({
    width: windowDims.width,
    height: windowDims.height,
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [rightTab, setRightTab] = useState<RightPaneTab>("lyrics");
  const [queueOpen, setQueueOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [lyricsMounted, setLyricsMounted] = useState(false);
  const pagerRef = useRef<ScrollView>(null);

  const { track, queue, index: activeQueueIndex, playing, loading, buffering, mode, error, lyrics, lyricsStatus } =
    player;
  const liked = useIsLiked(track?.hash);

  const containerWidth = containerSize.width || windowDims.width;
  const containerHeight = containerSize.height || windowDims.height;
  const isSplitLayout = containerWidth >= 720 && containerHeight >= 500;

  useEffect(() => {
    void libraryActions.ensure().catch(() => undefined);
  }, []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setLyricsMounted(true));
    return () => task.cancel();
  }, []);

  useEffect(() => {
    if (isSplitLayout || pageIndex === 1) {
      void playerActions.loadLyrics();
    }
  }, [isSplitLayout, pageIndex, track?.hash]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      router.dismiss();
      return true;
    });
    return () => subscription.remove();
  }, [router]);

  function handleContainerLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setContainerSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    }
  }

  function handleToggleLike() {
    if (!track || likeBusy) {
      return;
    }
    setLikeBusy(true);
    libraryActions
      .toggleLike(track)
      .then((result) => {
        showToast(result === "liked" ? "已加入「我喜欢」" : "已移出「我喜欢」");
      })
      .catch((cause) => {
        showToast(cause instanceof Error ? cause.message : "操作失败");
      })
      .finally(() => setLikeBusy(false));
  }

  const compact = containerHeight < 700;
  const discSize = isSplitLayout
    ? Math.min(Math.round(containerWidth * 0.28), Math.round(containerHeight * 0.38), 320)
    : Math.min(containerWidth - 104, compact ? 236 : 300);
  const busy = loading || buffering;

  function handlePagerScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / containerWidth);
    if (nextIndex !== pageIndex) {
      setPageIndex(nextIndex);
    }
  }

  const handleSeekLine = useCallback((line: { timeMs: number }) => {
    playerActions.seekToMs(line.timeMs);
  }, []);

  if (!track) {
    return (
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap={16}
        backgroundColor={palette.background}
        paddingTop={insets.top}>
        <Ionicons name="musical-notes-outline" size={44} color={palette.textTertiary} />
        <Text color={palette.textTertiary} fontSize={14}>
          还没有正在播放的歌曲
        </Text>
        <XStack
          paddingHorizontal={24}
          height={42}
          alignItems="center"
          borderRadius={999}
          backgroundColor={palette.accentSoft}
          pressStyle={{ opacity: 0.7 }}
          onPress={() => router.back()}>
          <Text color={palette.accent} fontSize={14} fontWeight="600">
            返回
          </Text>
        </XStack>
      </YStack>
    );
  }

  const controlsSection = (
    <YStack
      paddingHorizontal={isSplitLayout ? 8 : 28}
      gap={compact && !isSplitLayout ? 14 : 18}
      maxWidth={isSplitLayout ? 440 : 620}
      width="100%"
      alignSelf="center">
      <XStack alignItems="center" justifyContent="center" gap={46}>
        <XStack
          width={40}
          height={40}
          alignItems="center"
          justifyContent="center"
          opacity={likeBusy ? 0.5 : 1}
          transition="quickest"
          pressStyle={{ opacity: 0.55, scale: 0.88 }}
          onPress={handleToggleLike}>
          <Ionicons
            name={liked ? "heart" : "heart-outline"}
            size={24}
            color={liked ? palette.accent : palette.textSecondary}
          />
        </XStack>
        <XStack
          width={40}
          height={40}
          alignItems="center"
          justifyContent="center"
          transition="quickest"
          pressStyle={{ opacity: 0.55, scale: 0.88 }}
          onPress={() => setActionsOpen(true)}>
          <MaterialCommunityIcons name="playlist-plus" size={24} color={palette.textSecondary} />
        </XStack>
        <XStack
          width={40}
          height={40}
          alignItems="center"
          justifyContent="center"
          transition="quickest"
          pressStyle={{ opacity: 0.55, scale: 0.88 }}
          onPress={() => {
            if (track) {
              void shareTrack(track);
            }
          }}>
          <Ionicons name="share-social-outline" size={22} color={palette.textSecondary} />
        </XStack>
      </XStack>

      <PlaybackProgress />

      <XStack alignItems="center" justifyContent="space-between">
        <XStack
          width={42}
          height={42}
          alignItems="center"
          justifyContent="center"
          transition="quickest"
          pressStyle={{ opacity: 0.55, scale: 0.9 }}
          onPress={() => playerActions.cycleMode()}>
          <MaterialCommunityIcons name={MODE_ICON[mode]} size={22} color={palette.textSecondary} />
        </XStack>

        <XStack
          width={52}
          height={52}
          alignItems="center"
          justifyContent="center"
          transition="quickest"
          pressStyle={{ opacity: 0.55, scale: 0.88 }}
          onPress={() => playerActions.previous()}>
          <Ionicons name="play-skip-back" size={28} color={palette.text} />
        </XStack>

        <XStack
          width={74}
          height={74}
          borderRadius={37}
          overflow="hidden"
          alignItems="center"
          justifyContent="center"
          transition="quickest"
          pressStyle={{ scale: 0.94, opacity: 0.9 }}
          onPress={() => playerActions.toggle()}>
          <LinearGradient
            colors={[palette.gradientStart, palette.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {busy ? (
            <Spinner size="small" color="#FFFFFF" />
          ) : (
            <Ionicons
              name={playing ? "pause" : "play"}
              size={30}
              color="#FFFFFF"
              style={playing ? undefined : { marginLeft: 3 }}
            />
          )}
        </XStack>

        <XStack
          width={52}
          height={52}
          alignItems="center"
          justifyContent="center"
          transition="quickest"
          pressStyle={{ opacity: 0.55, scale: 0.88 }}
          onPress={() => playerActions.next()}>
          <Ionicons name="play-skip-forward" size={28} color={palette.text} />
        </XStack>

        <XStack
          width={42}
          height={42}
          alignItems="center"
          justifyContent="center"
          transition="quickest"
          pressStyle={{ opacity: 0.55, scale: 0.9 }}
          onPress={() => {
            if (isSplitLayout) {
              setRightTab((current) => (current === "queue" ? "lyrics" : "queue"));
            } else {
              setQueueOpen(true);
            }
          }}>
          <MaterialCommunityIcons
            name="playlist-music"
            size={24}
            color={isSplitLayout && rightTab === "queue" ? palette.accent : palette.textSecondary}
          />
        </XStack>
      </XStack>
    </YStack>
  );

  return (
    <View flex={1} backgroundColor={palette.playerBottom} onLayout={handleContainerLayout}>
      <LinearGradient
        colors={[palette.playerTop, palette.playerBottom]}
        style={StyleSheet.absoluteFill}
      />

      <YStack flex={1} paddingTop={insets.top + 6} paddingBottom={Math.max(insets.bottom, 14) + 16}>
        {/* 顶栏 */}
        <XStack zIndex={1} alignItems="center" justifyContent="space-between" paddingHorizontal={18}>
          <XStack
            width={40}
            height={40}
            borderRadius={20}
            alignItems="center"
            justifyContent="center"
            transition="quickest"
            pressStyle={{ opacity: 0.6, scale: 0.92 }}
            onPress={() => router.dismiss()}>
            <Ionicons name="chevron-down" size={24} color={palette.textSecondary} />
          </XStack>

          <YStack alignItems="center" gap={2}>
            <Text color={palette.textTertiary} fontSize={11} letterSpacing={1.2}>
              正在播放
            </Text>
            {isSplitLayout ? null : (
              <XStack gap={5} alignItems="center">
                {[0, 1].map((dot) => (
                  <View
                    key={dot}
                    width={dot === pageIndex ? 14 : 5}
                    height={5}
                    borderRadius={999}
                    backgroundColor={dot === pageIndex ? palette.accent : palette.textTertiary}
                    opacity={dot === pageIndex ? 1 : 0.4}
                    transition="quick"
                    onPress={() => {
                      pagerRef.current?.scrollTo({ x: dot * containerWidth, animated: true });
                      setPageIndex(dot);
                    }}
                  />
                ))}
              </XStack>
            )}
          </YStack>

          <View width={40} height={40} />
        </XStack>

        {isSplitLayout ? (
          /* iPad 左右分栏播放器 */
          <XStack flex={1} paddingHorizontal={28} paddingTop={8} gap={32} alignItems="stretch">
            <YStack flex={1} alignItems="center" justifyContent="center" gap={22} maxWidth={480}>
              <SpinningDisc coverUrl={track.coverUrl} playing={playing} size={discSize} />

              <YStack alignItems="center" gap={6} paddingHorizontal={16} maxWidth={440}>
                <Text
                  color={palette.text}
                  fontSize={22}
                  fontWeight="800"
                  textAlign="center"
                  numberOfLines={1}>
                  {track.title}
                </Text>
                <Text color={palette.textSecondary} fontSize={14.5} numberOfLines={1}>
                  {track.artist || "未知歌手"}
                </Text>
                {error ? (
                  <XStack
                    alignItems="center"
                    gap={6}
                    marginTop={4}
                    paddingHorizontal={13}
                    paddingVertical={7}
                    borderRadius={999}
                    backgroundColor={palette.dangerSoft}>
                    <Ionicons name="alert-circle" size={13} color={palette.danger} />
                    <Text color={palette.danger} fontSize={12}>
                      {error}
                    </Text>
                  </XStack>
                ) : null}
              </YStack>

              {controlsSection}
            </YStack>

            <YStack
              flex={1.15}
              borderRadius={24}
              backgroundColor={palette.card}
              borderWidth={StyleSheet.hairlineWidth}
              borderColor={palette.border}
              overflow="hidden"
              paddingTop={14}
              paddingBottom={10}>
              <XStack paddingHorizontal={18} paddingBottom={10} alignItems="center" justifyContent="space-between">
                <View width={196}>
                  <SegmentedControl
                    options={RIGHT_PANE_OPTIONS}
                    value={rightTab}
                    onChange={setRightTab}
                  />
                </View>
                {rightTab === "queue" && queue.length ? (
                  <XStack
                    paddingHorizontal={12}
                    paddingVertical={6}
                    borderRadius={999}
                    backgroundColor={palette.dangerSoft}
                    pressStyle={{ opacity: 0.7 }}
                    onPress={() => playerActions.clearQueue()}>
                    <Text color={palette.danger} fontSize={12} fontWeight="600">
                      清空 ({queue.length})
                    </Text>
                  </XStack>
                ) : (
                  <Text color={palette.textTertiary} fontSize={12}>
                    点击歌词可跳转进度
                  </Text>
                )}
              </XStack>

              {rightTab === "lyrics" ? (
                lyricsMounted ? (
                  <LyricsView
                    lines={lyrics}
                    status={lyricsStatus}
                    fontSize={19}
                    onSeekLine={handleSeekLine}
                    onRetry={() => void playerActions.loadLyrics()}
                  />
                ) : null
              ) : (
                <FlatList
                  data={queue}
                  keyExtractor={(item, idx) => `${item.hash}-${idx}`}
                  contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 16 }}
                  renderItem={({ item, index }) => {
                    const isCurrent = index === activeQueueIndex;
                    return (
                      <XStack
                        alignItems="center"
                        gap={12}
                        paddingVertical={9}
                        paddingHorizontal={12}
                        borderRadius={14}
                        backgroundColor={isCurrent ? palette.accentSoft : "transparent"}
                        pressStyle={{ opacity: 0.7 }}
                        onPress={() => void playerActions.jumpTo(index)}>
                        <Text
                          width={24}
                          color={isCurrent ? palette.accent : palette.textTertiary}
                          fontSize={12.5}
                          fontWeight={isCurrent ? "700" : "500"}
                          textAlign="center">
                          {index + 1}
                        </Text>
                        <Artwork uri={item.coverUrl} size={40} radius={10} />
                        <YStack flex={1} gap={2}>
                          <Text
                            color={isCurrent ? palette.accent : palette.text}
                            fontSize={14}
                            fontWeight={isCurrent ? "700" : "600"}
                            numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text color={palette.textTertiary} fontSize={12} numberOfLines={1}>
                            {item.artist || "未知歌手"}
                          </Text>
                        </YStack>
                        <XStack
                          width={32}
                          height={32}
                          alignItems="center"
                          justifyContent="center"
                          pressStyle={{ opacity: 0.5 }}
                          onPress={(event) => {
                            event.stopPropagation();
                            playerActions.removeAt(index);
                          }}>
                          <Ionicons name="close" size={18} color={palette.textTertiary} />
                        </XStack>
                      </XStack>
                    );
                  }}
                />
              )}
            </YStack>
          </XStack>
        ) : (
          /* 手机 / 窄分屏 双页模式（使用容器实际宽度，避免 iPad 歪斜） */
          <>
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handlePagerScroll}
              style={{ flex: 1 }}>
              <YStack
                width={containerWidth}
                alignItems="center"
                justifyContent="center"
                gap={compact ? 20 : 30}>
                <SpinningDisc coverUrl={track.coverUrl} playing={playing} size={discSize} />

                <YStack alignItems="center" gap={7} paddingHorizontal={40} maxWidth={560}>
                  <Text
                    color={palette.text}
                    fontSize={compact ? 19 : 22}
                    fontWeight="800"
                    textAlign="center"
                    numberOfLines={1}>
                    {track.title}
                  </Text>
                  <Text color={palette.textSecondary} fontSize={14} numberOfLines={1}>
                    {track.artist || "未知歌手"}
                  </Text>
                  {error ? (
                    <XStack
                      alignItems="center"
                      gap={6}
                      marginTop={4}
                      paddingHorizontal={13}
                      paddingVertical={7}
                      borderRadius={999}
                      backgroundColor={palette.dangerSoft}>
                      <Ionicons name="alert-circle" size={13} color={palette.danger} />
                      <Text color={palette.danger} fontSize={12}>
                        {error}
                      </Text>
                    </XStack>
                  ) : null}
                </YStack>
              </YStack>

              <YStack width={containerWidth} paddingTop={8}>
                {lyricsMounted ? (
                  <LyricsView
                    lines={lyrics}
                    status={lyricsStatus}
                    onSeekLine={handleSeekLine}
                    onRetry={() => void playerActions.loadLyrics()}
                  />
                ) : null}
              </YStack>
            </ScrollView>

            {controlsSection}
          </>
        )}
      </YStack>

      <QueueSheet open={queueOpen} onOpenChange={setQueueOpen} />
      <TrackActionsSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        track={track}
        initialView="pick"
      />
      <ToastHost />
    </View>
  );
}

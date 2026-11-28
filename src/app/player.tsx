import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  FlatList,
  InteractionManager,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Slider, Spinner, Text, View, XStack, YStack } from "tamagui";

import { Artwork } from "@/components/ui/artwork";
import { LyricsView } from "@/components/ui/lyrics-view";
import { QueueSheet } from "@/components/ui/queue-sheet";
import { showToast, ToastHost } from "@/components/ui/toast";
import { TrackActionsSheet } from "@/components/ui/track-actions-sheet";
import { libraryActions, useIsLiked } from "@/features/library/store";
import { offlineCacheActions, useOfflineCache } from "@/features/player/cache-store";
import { playerActions, usePlayer, usePlayerProgress } from "@/features/player/store";
import type { PlayMode } from "@/features/player/types";
import { searchArtists } from "@/features/search/search-api";
import { useSettings, type AudioEffectMode, type AudioQuality } from "@/features/settings/store";
import { usePalette } from "@/hooks/use-palette";
import { formatClock, sizedImage } from "@/lib/format";
import { shareTrack } from "@/lib/share";

const MODE_ICON: Record<Exclude<PlayMode, "none">, "repeat" | "repeat-once" | "shuffle-variant"> = {
  sequence: "repeat",
  shuffle: "shuffle-variant",
  single: "repeat-once",
};

const MODE_LABEL: Record<PlayMode, string> = {
  sequence: "列表循环",
  shuffle: "随机播放",
  single: "单曲循环",
  none: "禁用歌曲切换（播完停止）",
};

type RightPaneTab = "lyrics" | "queue";

const QUALITY_LABELS: Record<AudioQuality, string> = {
  "128": "标准 128k",
  "320": "HQ 320k",
  flac: "SQ 无损",
};

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;
const SLEEP_OPTIONS = [15, 30, 60] as const;

const AUDIO_EFFECT_PRESETS: readonly {
  id: AudioEffectMode;
  title: string;
  desc: string;
  badge?: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { id: "off", title: "原声关闭", desc: "无额外音染，还原母带原声", icon: "musical-note-outline" },
  { id: "8d", title: "8D 环绕", desc: "声音追着耳朵动，360° 环绕", badge: "8D", icon: "infinite" },
  { id: "3d", title: "3D 环绕", desc: "宽广空间声场，立体沉浸感", badge: "3D", icon: "planet-outline" },
  { id: "stereo", title: "立体声增强", desc: "强化左右声道分离与临场感", icon: "headset-outline" },
  { id: "bass", title: "超重低音", desc: "低频下潜增强，鼓点更有弹性", icon: "pulse" },
  { id: "vocal", title: "清澈人声", desc: "突出人声频段，适合流行民谣", icon: "mic-outline" },
  { id: "live", title: "现场演唱会", desc: "模拟 Live 厅堂混响空间感", icon: "sparkles-outline" },
];

/**
 * Apple Music 风格圆角矩形封面：播放时全尺寸浮起，暂停时轻微缩小。
 */
function AlbumCover({
  coverUrl,
  playing,
  size,
}: {
  coverUrl: string | null;
  playing: boolean;
  size: number;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withSpring(playing ? 1 : 0.92, {
          damping: 18,
          stiffness: 180,
        }),
      },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: 16,
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 20 },
          shadowOpacity: playing ? 0.48 : 0.25,
          shadowRadius: playing ? 34 : 18,
          elevation: 18,
        },
        animatedStyle,
      ]}>
      <Artwork uri={coverUrl} size={size} radius={16} />
    </Animated.View>
  );
}

function AppleProgressBar() {
  const { positionMs, durationMs } = usePlayerProgress();
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragValueRef = useRef<number | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownPosition = dragValue ?? positionMs;
  const remainingMs = Math.max(0, durationMs - shownPosition);

  return (
    <YStack gap={6}>
      <Slider
        size="$2"
        hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
        value={[Math.min(shownPosition, Math.max(durationMs, 1))]}
        max={Math.max(durationMs, 1)}
        step={250}
        disabled={!durationMs}
        onSlideStart={() => {
          if (clearTimerRef.current) {
            clearTimeout(clearTimerRef.current);
            clearTimerRef.current = null;
          }
        }}
        onValueChange={(values) => {
          const next = values[0] ?? 0;
          dragValueRef.current = next;
          setDragValue(next);
        }}
        onSlideEnd={(_event, value) => {
          const target = dragValueRef.current ?? (typeof value === "number" ? value : null);
          dragValueRef.current = null;
          if (target !== null) {
            void playerActions.seekToMs(target);
          }
          if (clearTimerRef.current) {
            clearTimeout(clearTimerRef.current);
          }
          clearTimerRef.current = setTimeout(() => {
            setDragValue(null);
            clearTimerRef.current = null;
          }, 420);
        }}>
        <Slider.Track backgroundColor="rgba(255, 255, 255, 0.22)" height={5} borderRadius={999}>
          <Slider.TrackActive backgroundColor="rgba(255, 255, 255, 0.92)" />
        </Slider.Track>
        <Slider.Thumb
          index={0}
          size={12}
          circular
          backgroundColor="#FFFFFF"
          borderWidth={0}
          pressStyle={{
            scale: 1.45,
            backgroundColor: "#FFFFFF",
          }}
          hoverStyle={{ backgroundColor: "#FFFFFF" }}
          shadowColor="#000000"
          shadowOpacity={0.28}
          shadowRadius={4}
          shadowOffset={{ width: 0, height: 1 }}
        />
      </Slider>
      <XStack justifyContent="space-between">
        <Text color="rgba(255, 255, 255, 0.62)" fontSize={11.5} fontWeight="600" fontVariant={["tabular-nums"]}>
          {formatClock(shownPosition)}
        </Text>
        <Text color="rgba(255, 255, 255, 0.62)" fontSize={11.5} fontWeight="600" fontVariant={["tabular-nums"]}>
          {durationMs > 0 ? `-${formatClock(remainingMs)}` : "0:00"}
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
  const [showTranslation, setShowTranslation] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [artistBusy, setArtistBusy] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [lyricsMounted, setLyricsMounted] = useState(false);
  const pagerRef = useRef<ScrollView>(null);

  const {
    track,
    queue,
    index: activeQueueIndex,
    playing,
    loading,
    buffering,
    mode,
    error,
    lyrics,
    lyricsStatus,
    activeQuality,
    fromCache,
    playbackRate,
    sleepTimerEndAt,
    sleepMinutesLeft,
    sleepAfterCurrentTrack,
  } = player;
  const { lyricSize, audioEffect } = useSettings();
  const activeFxLabel = AUDIO_EFFECT_PRESETS.find((item) => item.id === audioEffect)?.title ?? "原声关闭";
  const offlineCache = useOfflineCache();
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

  async function handleOpenArtist() {
    const rawArtist = track?.artist?.trim();
    if (!rawArtist || rawArtist === "未知歌手" || artistBusy) {
      return;
    }

    const primaryArtist = rawArtist.split(/[、,/&]/)[0]?.trim() || rawArtist;
    setArtistBusy(true);
    try {
      const res = await searchArtists(primaryArtist, 1);
      const matched =
        res.items.find((item) => item.name.toLowerCase() === primaryArtist.toLowerCase()) ??
        res.items[0];
      if (!matched) {
        showToast("未找到该歌手主页");
        return;
      }
      router.dismiss();
      setTimeout(() => {
        router.push({
          pathname: "/artist/[id]",
          params: {
            id: matched.id,
            name: matched.name,
            avatar: matched.avatarUrl ?? "",
          },
        });
      }, 120);
    } catch {
      showToast("歌手信息加载失败");
    } finally {
      setArtistBusy(false);
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
  const artSize = isSplitLayout
    ? Math.min(Math.round(containerWidth * 0.31), Math.round(containerHeight * 0.44), 380)
    : Math.min(containerWidth - 72, compact ? 250 : 330);
  const busy = loading || buffering;
  const hasTranslation = lyrics.some((line) => Boolean(line.translation));
  const isCached = Boolean(track && offlineCache.entries.some((item) => item.hash === track.hash));
  const isDownloading = Boolean(track && offlineCache.downloadingHashes.includes(track.hash));
  const splitLyricFontSize = lyricSize === "sm" ? 21 : lyricSize === "lg" ? 31 : 26;
  const narrowLyricFontSize = lyricSize === "sm" ? 18 : lyricSize === "lg" ? 25 : 21;
  const coverBackdropUri = sizedImage(track?.coverUrl ?? null, 480);

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

  const transportControls = (
    <YStack width={isSplitLayout ? artSize : "100%"} maxWidth={isSplitLayout ? artSize : 460} gap={18} alignSelf="center">
      {/* 标题 + 歌手 + 收藏/更多 */}
      <XStack alignItems="center" justifyContent="space-between" gap={12}>
        <YStack flex={1} gap={3}>
          <Text color="#FFFFFF" fontSize={isSplitLayout ? 21 : 20} fontWeight="800" numberOfLines={1}>
            {track.title}
          </Text>
          <XStack
            alignSelf="flex-start"
            alignItems="center"
            gap={3}
            opacity={artistBusy ? 0.5 : 1}
            pressStyle={track.artist && track.artist !== "未知歌手" ? { opacity: 0.6 } : undefined}
            onPress={
              track.artist && track.artist !== "未知歌手"
                ? () => void handleOpenArtist()
                : undefined
            }>
            <Text color="rgba(255, 255, 255, 0.72)" fontSize={15} fontWeight="500" numberOfLines={1}>
              {track.artist || "未知歌手"}
            </Text>
            {track.artist && track.artist !== "未知歌手" ? (
              <Ionicons name="chevron-forward" size={14} color="rgba(255, 255, 255, 0.5)" />
            ) : null}
          </XStack>
        </YStack>
        <XStack alignItems="center" gap={8}>
          <XStack
            width={34}
            height={34}
            borderRadius={17}
            alignItems="center"
            justifyContent="center"
            backgroundColor="rgba(255, 255, 255, 0.14)"
            opacity={likeBusy ? 0.5 : 1}
            pressStyle={{ opacity: 0.65, scale: 0.9 }}
            onPress={handleToggleLike}>
            <Ionicons
              name={liked ? "heart" : "heart-outline"}
              size={18}
              color={liked ? "#FF375F" : "#FFFFFF"}
            />
          </XStack>
          <XStack
            width={34}
            height={34}
            borderRadius={17}
            alignItems="center"
            justifyContent="center"
            backgroundColor="rgba(255, 255, 255, 0.14)"
            pressStyle={{ opacity: 0.65, scale: 0.9 }}
            onPress={() => setActionsOpen(true)}>
            <Ionicons name="ellipsis-horizontal" size={18} color="#FFFFFF" />
          </XStack>
        </XStack>
      </XStack>

      {error ? (
        <XStack
          alignItems="center"
          gap={6}
          paddingHorizontal={12}
          paddingVertical={6}
          borderRadius={999}
          backgroundColor="rgba(255, 69, 58, 0.22)">
          <Ionicons name="alert-circle" size={14} color="#FF6961" />
          <Text color="#FFD5D2" fontSize={12}>
            {error}
          </Text>
        </XStack>
      ) : null}

      <AppleProgressBar />

      {/* Apple Music 风格音质、音效与状态胶囊 */}
      <XStack justifyContent="center" alignItems="center" gap={8} flexWrap="wrap">
        <XStack
          alignItems="center"
          gap={5}
          paddingHorizontal={10}
          paddingVertical={4}
          borderRadius={999}
          backgroundColor="rgba(255, 255, 255, 0.12)"
          pressStyle={{ opacity: 0.7 }}
          onPress={() => setToolsOpen(true)}>
          <Ionicons name="musical-note" size={11} color="rgba(255, 255, 255, 0.85)" />
          <Text color="rgba(255, 255, 255, 0.88)" fontSize={11} fontWeight="600">
            {QUALITY_LABELS[activeQuality]}
            {fromCache ? " · 已缓存" : ""}
            {playbackRate !== 1 ? ` · ${playbackRate}x` : ""}
            {sleepAfterCurrentTrack
              ? " · 播完暂停"
              : sleepMinutesLeft
              ? ` · ${sleepMinutesLeft}分后停`
              : ""}
          </Text>
        </XStack>

        <XStack
          alignItems="center"
          gap={5}
          paddingHorizontal={10}
          paddingVertical={4}
          borderRadius={999}
          backgroundColor={
            audioEffect !== "off" ? "rgba(255, 214, 102, 0.24)" : "rgba(255, 255, 255, 0.12)"
          }
          pressStyle={{ opacity: 0.7 }}
          onPress={() => setFxOpen(true)}>
          <Ionicons
            name={audioEffect === "8d" ? "infinite" : "options-outline"}
            size={12}
            color={audioEffect !== "off" ? "#FFD666" : "rgba(255, 255, 255, 0.85)"}
          />
          <Text
            color={audioEffect !== "off" ? "#FFD666" : "rgba(255, 255, 255, 0.88)"}
            fontSize={11}
            fontWeight="600">
            {audioEffect !== "off" ? activeFxLabel : "音效"}
          </Text>
        </XStack>
      </XStack>

      {/* 主播控：极简白图标，对齐 Apple Music */}
      <XStack alignItems="center" justifyContent="space-between" paddingHorizontal={12} paddingVertical={2}>
        <XStack
          width={44}
          height={44}
          alignItems="center"
          justifyContent="center"
          pressStyle={{ opacity: 0.55, scale: 0.9 }}
          onPress={() => {
            const next = playerActions.cycleMode();
            showToast(MODE_LABEL[next]);
          }}>
          {mode === "none" ? (
            <XStack alignItems="center" gap={1}>
              <Ionicons name="play" size={14} color="#FFFFFF" />
              <Text color="#FFFFFF" fontSize={13} fontWeight="800" lineHeight={15}>
                1
              </Text>
            </XStack>
          ) : (
            <MaterialCommunityIcons
              name={MODE_ICON[mode]}
              size={21}
              color={mode === "sequence" ? "rgba(255, 255, 255, 0.55)" : "#FFFFFF"}
            />
          )}
        </XStack>

        <XStack
          width={52}
          height={52}
          alignItems="center"
          justifyContent="center"
          pressStyle={{ opacity: 0.55, scale: 0.88 }}
          onPress={() => playerActions.previous()}>
          <Ionicons name="play-skip-back" size={30} color="#FFFFFF" />
        </XStack>

        <XStack
          width={64}
          height={64}
          alignItems="center"
          justifyContent="center"
          pressStyle={{ opacity: 0.6, scale: 0.9 }}
          onPress={() => playerActions.toggle()}>
          {busy ? (
            <Spinner size="large" color="#FFFFFF" />
          ) : (
            <Ionicons
              name={playing ? "pause" : "play"}
              size={42}
              color="#FFFFFF"
              style={playing ? undefined : { marginLeft: 4 }}
            />
          )}
        </XStack>

        <XStack
          width={52}
          height={52}
          alignItems="center"
          justifyContent="center"
          pressStyle={{ opacity: 0.55, scale: 0.88 }}
          onPress={() => playerActions.next()}>
          <Ionicons name="play-skip-forward" size={30} color="#FFFFFF" />
        </XStack>

        <XStack
          width={44}
          height={44}
          alignItems="center"
          justifyContent="center"
          pressStyle={{ opacity: 0.55, scale: 0.9 }}
          onPress={() => {
            if (track) {
              void shareTrack(track);
            }
          }}>
          <Ionicons name="share-outline" size={20} color="rgba(255, 255, 255, 0.72)" />
        </XStack>
      </XStack>
    </YStack>
  );

  return (
    <View flex={1} backgroundColor="#0D0D12" onLayout={handleContainerLayout}>
      {/* 动态封面模糊背景 */}
      {coverBackdropUri ? (
        <Image
          source={{ uri: coverBackdropUri }}
          blurRadius={90}
          contentFit="cover"
          style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.25 }], opacity: 0.85 }]}
        />
      ) : null}
      <LinearGradient
        colors={["rgba(12, 12, 18, 0.34)", "rgba(8, 8, 12, 0.64)"]}
        style={StyleSheet.absoluteFill}
      />

      <YStack flex={1} paddingTop={insets.top + 8} paddingBottom={Math.max(insets.bottom, 16) + 12}>
        {/* 极简顶栏 */}
        <XStack zIndex={1} alignItems="center" justifyContent="space-between" paddingHorizontal={22}>
          <XStack
            width={36}
            height={36}
            borderRadius={18}
            alignItems="center"
            justifyContent="center"
            backgroundColor="rgba(255, 255, 255, 0.14)"
            transition="quickest"
            pressStyle={{ opacity: 0.6, scale: 0.92 }}
            onPress={() => router.dismiss()}>
            <Ionicons name="chevron-down" size={20} color="#FFFFFF" />
          </XStack>

          {isSplitLayout ? (
            <XStack
              gap={4}
              padding={3}
              borderRadius={999}
              backgroundColor="rgba(255, 255, 255, 0.12)">
              {(
                [
                  { value: "lyrics", label: "歌词" },
                  { value: "queue", label: `队列 (${queue.length})` },
                ] as const
              ).map((tab) => {
                const active = rightTab === tab.value;
                return (
                  <XStack
                    key={tab.value}
                    paddingHorizontal={14}
                    paddingVertical={6}
                    borderRadius={999}
                    backgroundColor={active ? "rgba(255, 255, 255, 0.24)" : "transparent"}
                    pressStyle={{ opacity: 0.7 }}
                    onPress={() => setRightTab(tab.value)}>
                    <Text color="#FFFFFF" fontSize={12.5} fontWeight={active ? "700" : "500"}>
                      {tab.label}
                    </Text>
                  </XStack>
                );
              })}
            </XStack>
          ) : (
            <XStack gap={6} alignItems="center">
              {[0, 1].map((dot) => (
                <View
                  key={dot}
                  width={dot === pageIndex ? 16 : 6}
                  height={6}
                  borderRadius={999}
                  backgroundColor="#FFFFFF"
                  opacity={dot === pageIndex ? 0.95 : 0.35}
                  transition="quick"
                  onPress={() => {
                    pagerRef.current?.scrollTo({ x: dot * containerWidth, animated: true });
                    setPageIndex(dot);
                  }}
                />
              ))}
            </XStack>
          )}

          {!isSplitLayout ? (
            <XStack
              width={36}
              height={36}
              borderRadius={18}
              alignItems="center"
              justifyContent="center"
              backgroundColor="rgba(255, 255, 255, 0.14)"
              pressStyle={{ opacity: 0.6 }}
              onPress={() => setQueueOpen(true)}>
              <MaterialCommunityIcons name="playlist-music" size={19} color="#FFFFFF" />
            </XStack>
          ) : (
            <View width={36} height={36} />
          )}
        </XStack>

        {isSplitLayout ? (
          /* Apple Music iPad 左右分栏布局（无卡片边框，歌词直接悬浮于模糊背景） */
          <XStack flex={1} paddingHorizontal={40} gap={44} alignItems="center">
            <YStack flex={0.92} alignItems="center" justifyContent="center" gap={26}>
              <AlbumCover coverUrl={track.coverUrl} playing={playing} size={artSize} />
              {transportControls}
            </YStack>

            <YStack flex={1.18} height="86%" justifyContent="center">
              {rightTab === "lyrics" ? (
                lyricsMounted ? (
                  <View flex={1} position="relative">
                    <LyricsView
                      lines={lyrics}
                      status={lyricsStatus}
                      fontSize={splitLyricFontSize}
                      textAlign="left"
                      immersive
                      showTranslation={showTranslation}
                      onSeekLine={handleSeekLine}
                      onRetry={() => void playerActions.loadLyrics()}
                    />
                    {hasTranslation ? (
                      <XStack
                        position="absolute"
                        right={12}
                        bottom={8}
                        width={36}
                        height={36}
                        borderRadius={12}
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor={
                          showTranslation ? "rgba(255, 255, 255, 0.24)" : "rgba(255, 255, 255, 0.1)"
                        }
                        pressStyle={{ opacity: 0.7, scale: 0.92 }}
                        onPress={() => setShowTranslation((prev) => !prev)}>
                        <Ionicons
                          name="language"
                          size={18}
                          color={showTranslation ? "#FFFFFF" : "rgba(255, 255, 255, 0.55)"}
                        />
                      </XStack>
                    ) : null}
                  </View>
                ) : null
              ) : (
                <YStack flex={1} gap={12}>
                  <XStack justifyContent="space-between" alignItems="center" paddingHorizontal={12}>
                    <Text color="rgba(255, 255, 255, 0.72)" fontSize={14} fontWeight="700">
                      待播清单 · {queue.length} 首
                    </Text>
                    {queue.length ? (
                      <XStack
                        paddingHorizontal={12}
                        paddingVertical={5}
                        borderRadius={999}
                        backgroundColor="rgba(255, 255, 255, 0.14)"
                        pressStyle={{ opacity: 0.7 }}
                        onPress={() => playerActions.clearQueue()}>
                        <Text color="#FFFFFF" fontSize={12} fontWeight="600">
                          清空
                        </Text>
                      </XStack>
                    ) : null}
                  </XStack>
                  <FlatList
                    data={queue}
                    keyExtractor={(item, idx) => `${item.hash}-${idx}`}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 20 }}
                    renderItem={({ item, index }) => {
                      const isCurrent = index === activeQueueIndex;
                      return (
                        <XStack
                          alignItems="center"
                          gap={12}
                          paddingVertical={9}
                          paddingHorizontal={12}
                          borderRadius={14}
                          backgroundColor={isCurrent ? "rgba(255, 255, 255, 0.16)" : "transparent"}
                          pressStyle={{ opacity: 0.7 }}
                          onPress={() => void playerActions.jumpTo(index)}>
                          <Artwork uri={item.coverUrl} size={42} radius={8} />
                          <YStack flex={1} gap={2}>
                            <Text
                              color="#FFFFFF"
                              fontSize={14.5}
                              fontWeight={isCurrent ? "700" : "600"}
                              numberOfLines={1}>
                              {item.title}
                            </Text>
                            <Text color="rgba(255, 255, 255, 0.62)" fontSize={12.5} numberOfLines={1}>
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
                            <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.6)" />
                          </XStack>
                        </XStack>
                      );
                    }}
                  />
                </YStack>
              )}
            </YStack>
          </XStack>
        ) : (
          /* 手机 / 窄分屏模式 */
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
                paddingHorizontal={28}>
                <AlbumCover coverUrl={track.coverUrl} playing={playing} size={artSize} />
              </YStack>

              <YStack width={containerWidth} paddingTop={8} paddingHorizontal={12}>
                {lyricsMounted ? (
                  <View flex={1} position="relative">
                    <LyricsView
                      lines={lyrics}
                      status={lyricsStatus}
                      fontSize={narrowLyricFontSize}
                      textAlign="left"
                      immersive
                      showTranslation={showTranslation}
                      onSeekLine={handleSeekLine}
                      onRetry={() => void playerActions.loadLyrics()}
                    />
                    {hasTranslation ? (
                      <XStack
                        position="absolute"
                        right={16}
                        bottom={10}
                        width={34}
                        height={34}
                        borderRadius={11}
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor={
                          showTranslation ? "rgba(255, 255, 255, 0.24)" : "rgba(255, 255, 255, 0.1)"
                        }
                        pressStyle={{ opacity: 0.7, scale: 0.92 }}
                        onPress={() => setShowTranslation((prev) => !prev)}>
                        <Ionicons
                          name="language"
                          size={17}
                          color={showTranslation ? "#FFFFFF" : "rgba(255, 255, 255, 0.55)"}
                        />
                      </XStack>
                    ) : null}
                  </View>
                ) : null}
              </YStack>
            </ScrollView>

            <YStack paddingHorizontal={28} paddingBottom={8}>
              {transportControls}
            </YStack>
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
      <Modal
        visible={toolsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setToolsOpen(false)}>
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0, 0, 0, 0.55)",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
          onPress={() => setToolsOpen(false)}>
          <Pressable
            style={{ width: "100%", maxWidth: 420 }}
            onPress={(event) => event.stopPropagation()}>
            <YStack
              backgroundColor="#1B1C24"
              borderRadius={24}
              borderWidth={StyleSheet.hairlineWidth}
              borderColor="rgba(255, 255, 255, 0.12)"
              padding={20}
              gap={18}>
              <XStack alignItems="center" justifyContent="space-between">
                <Text color="#FFFFFF" fontSize={17} fontWeight="800">
                  播放设置与工具
                </Text>
                <XStack
                  width={30}
                  height={30}
                  borderRadius={15}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="rgba(255, 255, 255, 0.12)"
                  onPress={() => setToolsOpen(false)}>
                  <Ionicons name="close" size={16} color="#FFFFFF" />
                </XStack>
              </XStack>

              <YStack gap={8}>
                <Text color="rgba(255, 255, 255, 0.65)" fontSize={12.5} fontWeight="600">
                  切换音质
                </Text>
                <XStack gap={8}>
                  {(["128", "320", "flac"] as const).map((q) => {
                    const active = activeQuality === q && !fromCache;
                    return (
                      <XStack
                        key={q}
                        flex={1}
                        height={38}
                        borderRadius={12}
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor={
                          active ? "rgba(255, 255, 255, 0.24)" : "rgba(255, 255, 255, 0.08)"
                        }
                        pressStyle={{ opacity: 0.7 }}
                        onPress={() => {
                          setToolsOpen(false);
                          void playerActions.switchQuality(q);
                        }}>
                        <Text color="#FFFFFF" fontSize={12.5} fontWeight={active ? "700" : "500"}>
                          {QUALITY_LABELS[q]}
                        </Text>
                      </XStack>
                    );
                  })}
                </XStack>
              </YStack>

              <YStack gap={8}>
                <Text color="rgba(255, 255, 255, 0.65)" fontSize={12.5} fontWeight="600">
                  倍速播放
                </Text>
                <XStack gap={8}>
                  {SPEED_OPTIONS.map((rate) => {
                    const active = playbackRate === rate;
                    return (
                      <XStack
                        key={rate}
                        flex={1}
                        height={36}
                        borderRadius={12}
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor={
                          active ? "rgba(255, 255, 255, 0.24)" : "rgba(255, 255, 255, 0.08)"
                        }
                        pressStyle={{ opacity: 0.7 }}
                        onPress={() => playerActions.setPlaybackRate(rate)}>
                        <Text color="#FFFFFF" fontSize={12.5} fontWeight={active ? "700" : "500"}>
                          {rate}x
                        </Text>
                      </XStack>
                    );
                  })}
                </XStack>
              </YStack>

              <YStack gap={8}>
                <Text color="rgba(255, 255, 255, 0.65)" fontSize={12.5} fontWeight="600">
                  定时关闭
                </Text>
                <XStack flexWrap="wrap" gap={8}>
                  <XStack
                    paddingHorizontal={12}
                    height={36}
                    borderRadius={12}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor={
                      !sleepTimerEndAt && !sleepAfterCurrentTrack
                        ? "rgba(255, 255, 255, 0.24)"
                        : "rgba(255, 255, 255, 0.08)"
                    }
                    pressStyle={{ opacity: 0.7 }}
                    onPress={() => playerActions.clearSleepTimer()}>
                    <Text color="#FFFFFF" fontSize={12.5} fontWeight="600">
                      关闭
                    </Text>
                  </XStack>
                  <XStack
                    paddingHorizontal={12}
                    height={36}
                    borderRadius={12}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor={
                      sleepAfterCurrentTrack
                        ? "rgba(255, 255, 255, 0.24)"
                        : "rgba(255, 255, 255, 0.08)"
                    }
                    pressStyle={{ opacity: 0.7 }}
                    onPress={() => playerActions.setSleepAfterCurrentTrack()}>
                    <Text color="#FFFFFF" fontSize={12.5} fontWeight="600">
                      播完当前
                    </Text>
                  </XStack>
                  {SLEEP_OPTIONS.map((mins) => (
                    <XStack
                      key={mins}
                      paddingHorizontal={12}
                      height={36}
                      borderRadius={12}
                      alignItems="center"
                      justifyContent="center"
                      backgroundColor="rgba(255, 255, 255, 0.08)"
                      pressStyle={{ opacity: 0.7 }}
                      onPress={() => {
                        playerActions.setSleepTimer(mins);
                        showToast(`${mins} 分钟后自动暂停`);
                      }}>
                      <Text color="#FFFFFF" fontSize={12.5} fontWeight="600">
                        {mins} 分钟
                      </Text>
                    </XStack>
                  ))}
                </XStack>
              </YStack>

              <XStack
                height={42}
                borderRadius={14}
                alignItems="center"
                justifyContent="center"
                gap={8}
                backgroundColor={
                  isCached ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.22)"
                }
                opacity={isDownloading ? 0.6 : 1}
                pressStyle={{ opacity: 0.75 }}
                onPress={() => {
                  if (isDownloading) return;
                  if (isCached) {
                    offlineCacheActions.remove(track.hash);
                    showToast("已移除本地缓存");
                  } else {
                    void playerActions
                      .cacheCurrentTrack()
                      .then(() => showToast("已缓存到本地，断网可听"))
                      .catch((err) => showToast(err instanceof Error ? err.message : "缓存失败"));
                  }
                }}>
                {isDownloading ? (
                  <Spinner size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons
                    name={isCached ? "checkmark-circle" : "cloud-download-outline"}
                    size={17}
                    color="#FFFFFF"
                  />
                )}
                <Text color="#FFFFFF" fontSize={13.5} fontWeight="700">
                  {isDownloading
                    ? "正在缓存..."
                    : isCached
                    ? "已离线缓存（点击移除）"
                    : "离线缓存当前歌曲"}
                </Text>
              </XStack>
            </YStack>
          </Pressable>
        </Pressable>
      </Modal>
      {/* 洛雪/网易云风格音效选择面板 */}
      <Modal
        visible={fxOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFxOpen(false)}>
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0, 0, 0, 0.58)",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
          onPress={() => setFxOpen(false)}>
          <Pressable
            style={{ width: "100%", maxWidth: 460 }}
            onPress={(event) => event.stopPropagation()}>
            <YStack
              backgroundColor="#1B1C24"
              borderRadius={24}
              borderWidth={StyleSheet.hairlineWidth}
              borderColor="rgba(255, 255, 255, 0.12)"
              padding={20}
              gap={16}>
              <XStack alignItems="center" justifyContent="space-between">
                <YStack gap={2}>
                  <Text color="#FFFFFF" fontSize={17} fontWeight="800">
                    音效选择
                  </Text>
                  <Text color="rgba(255, 255, 255, 0.55)" fontSize={11.5}>
                    本地实时音频 DSP 处理，支持 8D / 3D 环绕与后台播放
                  </Text>
                </YStack>
                <XStack
                  width={30}
                  height={30}
                  borderRadius={15}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="rgba(255, 255, 255, 0.12)"
                  onPress={() => setFxOpen(false)}>
                  <Ionicons name="close" size={16} color="#FFFFFF" />
                </XStack>
              </XStack>

              <XStack flexWrap="wrap" gap={10}>
                {AUDIO_EFFECT_PRESETS.map((preset) => {
                  const active = audioEffect === preset.id;
                  return (
                    <YStack
                      key={preset.id}
                      width="48%"
                      padding={13}
                      borderRadius={16}
                      gap={6}
                      backgroundColor={
                        active ? "rgba(255, 214, 102, 0.16)" : "rgba(255, 255, 255, 0.07)"
                      }
                      borderWidth={1}
                      borderColor={
                        active ? "rgba(255, 214, 102, 0.6)" : "rgba(255, 255, 255, 0.08)"
                      }
                      pressStyle={{ opacity: 0.75, scale: 0.98 }}
                      onPress={() => {
                        playerActions.setAudioEffect(preset.id);
                        showToast(`已切换音效：${preset.title}`);
                      }}>
                      <XStack alignItems="center" justifyContent="space-between">
                        <Ionicons
                          name={preset.icon}
                          size={20}
                          color={active ? "#FFD666" : "#FFFFFF"}
                        />
                        {preset.badge ? (
                          <XStack
                            paddingHorizontal={6}
                            paddingVertical={2}
                            borderRadius={6}
                            backgroundColor={
                              active ? "#FFD666" : "rgba(255, 214, 102, 0.22)"
                            }>
                            <Text
                              color={active ? "#1B1C24" : "#FFD666"}
                              fontSize={10}
                              fontWeight="800">
                              {preset.badge}
                            </Text>
                          </XStack>
                        ) : null}
                      </XStack>
                      <Text
                        color={active ? "#FFD666" : "#FFFFFF"}
                        fontSize={14}
                        fontWeight="700">
                        {preset.title}
                      </Text>
                      <Text
                        color="rgba(255, 255, 255, 0.56)"
                        fontSize={11}
                        lineHeight={15}
                        numberOfLines={2}>
                        {preset.desc}
                      </Text>
                    </YStack>
                  );
                })}
              </XStack>
            </YStack>
          </Pressable>
        </Pressable>
      </Modal>

      <ToastHost />
    </View>
  );
}

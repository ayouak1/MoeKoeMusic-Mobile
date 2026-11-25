import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { ScrollView, type LayoutChangeEvent } from "react-native";
import { Spinner, Text, YStack } from "tamagui";

import { findActiveLyricIndex } from "@/features/player/lyrics";
import { usePlayerProgressSelector } from "@/features/player/store";
import type { LyricLine, LyricsStatus } from "@/features/player/types";
import { usePalette } from "@/hooks/use-palette";

type LyricsViewProps = {
  lines: LyricLine[];
  status: LyricsStatus;
  fontSize?: number;
  textAlign?: "center" | "left";
  immersive?: boolean;
  showTranslation?: boolean;
  onSeekLine?: (line: LyricLine) => void;
  onRetry?: () => void;
};

const RESUME_AUTO_SCROLL_MS = 3500;

type LyricRowProps = {
  line: LyricLine;
  index: number;
  active: boolean;
  fontSize: number;
  textAlign: "center" | "left";
  immersive: boolean;
  showTranslation: boolean;
  activeColor: ComponentProps<typeof Text>["color"];
  inactiveColor: ComponentProps<typeof Text>["color"];
  onLayoutLine: (index: number, offset: number) => void;
  onSeekLine?: (line: LyricLine) => void;
};

const LyricRow = memo(function LyricRow({
  line,
  index,
  active,
  fontSize,
  textAlign,
  immersive,
  showTranslation,
  activeColor,
  inactiveColor,
  onLayoutLine,
  onSeekLine,
}: LyricRowProps) {
  const transFontSize = Math.max(13, Math.round(fontSize * 0.68));

  return (
    <YStack
      width="100%"
      onLayout={(event) => onLayoutLine(index, event.nativeEvent.layout.y)}
      onPress={onSeekLine ? () => onSeekLine(line) : undefined}
      paddingVertical={immersive ? 12 : 10}
      gap={4}
      pressStyle={onSeekLine ? { opacity: 0.7 } : undefined}>
      <Text
        width="100%"
        suppressHighlighting
        textAlign={textAlign}
        color={active ? activeColor : inactiveColor}
        opacity={active ? 1 : immersive ? 0.4 : 0.58}
        fontSize={fontSize}
        lineHeight={Math.round(fontSize * 1.36)}
        fontWeight={active ? "800" : immersive ? "700" : "500"}
        transform={textAlign === "left" ? undefined : [{ scale: active ? 1.05 : 1 }]}
        transition="quick">
        {line.text}
      </Text>
      {showTranslation && line.translation ? (
        <Text
          width="100%"
          suppressHighlighting
          textAlign={textAlign}
          color={active ? activeColor : inactiveColor}
          opacity={active ? 0.86 : immersive ? 0.34 : 0.48}
          fontSize={transFontSize}
          lineHeight={Math.round(transFontSize * 1.38)}
          fontWeight={active ? "600" : "500"}>
          {line.translation}
        </Text>
      ) : null}
    </YStack>
  );
});

export function LyricsView({
  lines,
  status,
  fontSize = 16,
  textAlign = "center",
  immersive = false,
  showTranslation = true,
  onSeekLine,
  onRetry,
}: LyricsViewProps) {
  const palette = usePalette();
  const scrollRef = useRef<ScrollView>(null);
  const lineOffsets = useRef<number[]>([]);
  const userScrollUntil = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const activeIndex = usePlayerProgressSelector(({ positionMs }) =>
    findActiveLyricIndex(lines, positionMs + 240)
  );

  const handleLayoutLine = useCallback((index: number, offset: number) => {
    lineOffsets.current[index] = offset;
  }, []);

  useEffect(() => {
    lineOffsets.current = [];
  }, [lines]);

  useEffect(() => {
    if (activeIndex < 0 || !viewportHeight || Date.now() < userScrollUntil.current) {
      return;
    }

    const offset = lineOffsets.current[activeIndex];
    if (typeof offset !== "number") {
      return;
    }

    scrollRef.current?.scrollTo({
      y: Math.max(0, offset - viewportHeight * (immersive ? 0.34 : 0.42)),
      animated: true,
    });
  }, [activeIndex, viewportHeight, immersive]);

  const activeColor: ComponentProps<typeof Text>["color"] = immersive
    ? "#FFFFFF"
    : palette.accent;
  const inactiveColor: ComponentProps<typeof Text>["color"] = immersive
    ? "rgba(255, 255, 255, 0.85)"
    : palette.textSecondary;
  const mutedColor: ComponentProps<typeof Text>["color"] = immersive
    ? "rgba(255, 255, 255, 0.58)"
    : palette.textTertiary;

  if (status === "loading" || status === "idle") {
    return (
      <YStack flex={1} alignItems="center" justifyContent="center" gap={12}>
        <Spinner size="large" color={immersive ? "#FFFFFF" : palette.accent} />
        <Text color={mutedColor} fontSize={13}>
          歌词加载中
        </Text>
      </YStack>
    );
  }

  if (status === "error") {
    return (
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap={6}
        pressStyle={{ opacity: 0.65 }}
        onPress={onRetry}>
        <Text color={inactiveColor} fontSize={16} fontWeight="600">
          歌词加载失败
        </Text>
        <Text color={mutedColor} fontSize={12.5}>
          点击重试
        </Text>
      </YStack>
    );
  }

  if (!lines.length) {
    return (
      <YStack flex={1} alignItems="center" justifyContent="center" gap={6}>
        <Text color={inactiveColor} fontSize={16} fontWeight="600">
          暂无歌词
        </Text>
        <Text color={mutedColor} fontSize={12.5}>
          暂未找到匹配歌词
        </Text>
      </YStack>
    );
  }

  return (
    <MaskedView
      style={{ flex: 1 }}
      androidRenderingMode="hardware"
      maskElement={
        <LinearGradient
          colors={["transparent", "black", "black", "transparent"]}
          locations={[0, 0.1, 0.85, 1]}
          style={{ flex: 1 }}
        />
      }>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        onLayout={(event: LayoutChangeEvent) => setViewportHeight(event.nativeEvent.layout.height)}
        onScrollBeginDrag={() => {
          userScrollUntil.current = Date.now() + RESUME_AUTO_SCROLL_MS;
        }}
        contentContainerStyle={{
          paddingVertical: viewportHeight ? viewportHeight * 0.36 : 200,
          paddingHorizontal: immersive ? 16 : 28,
        }}>
        {lines.map((line, index) => (
          <LyricRow
            key={`${line.timeMs}-${index}`}
            line={line}
            index={index}
            active={index === activeIndex}
            fontSize={fontSize}
            textAlign={textAlign}
            immersive={immersive}
            showTranslation={showTranslation}
            activeColor={activeColor}
            inactiveColor={inactiveColor}
            onLayoutLine={handleLayoutLine}
            onSeekLine={onSeekLine}
          />
        ))}
      </ScrollView>
    </MaskedView>
  );
}

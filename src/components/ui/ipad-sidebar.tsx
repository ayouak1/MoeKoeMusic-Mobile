import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View, XStack, YStack } from "tamagui";

import { useIsDark, usePalette } from "@/hooks/use-palette";

type NavItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  route: "/" | "/discover" | "/me" | "/search" | "/recognize" | "/cloud" | "/settings";
  matchPaths: string[];
};

const PRIMARY_ITEMS: NavItem[] = [
  {
    key: "home",
    label: "首页",
    icon: "home-outline",
    activeIcon: "home",
    route: "/",
    matchPaths: ["/", "/index"],
  },
  {
    key: "discover",
    label: "发现",
    icon: "compass-outline",
    activeIcon: "compass",
    route: "/discover",
    matchPaths: ["/discover"],
  },
  {
    key: "me",
    label: "我的",
    icon: "person-outline",
    activeIcon: "person",
    route: "/me",
    matchPaths: ["/me"],
  },
];

const SHORTCUT_ITEMS: NavItem[] = [
  {
    key: "search",
    label: "搜索",
    icon: "search-outline",
    activeIcon: "search",
    route: "/search",
    matchPaths: ["/search"],
  },
  {
    key: "recognize",
    label: "听歌识曲",
    icon: "mic-outline",
    activeIcon: "mic",
    route: "/recognize",
    matchPaths: ["/recognize"],
  },
  {
    key: "cloud",
    label: "音乐云盘",
    icon: "cloud-outline",
    activeIcon: "cloud",
    route: "/cloud",
    matchPaths: ["/cloud"],
  },
  {
    key: "settings",
    label: "设置",
    icon: "settings-outline",
    activeIcon: "settings",
    route: "/settings",
    matchPaths: ["/settings"],
  },
];

function SidebarRow({
  item,
  active,
  compact,
  onPress,
}: {
  item: NavItem;
  active: boolean;
  compact: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();

  return (
    <XStack
      height={46}
      paddingHorizontal={compact ? 0 : 14}
      justifyContent={compact ? "center" : "flex-start"}
      alignItems="center"
      gap={12}
      borderRadius={14}
      backgroundColor={active ? palette.accentSoft : "transparent"}
      transition="quickest"
      pressStyle={{ opacity: 0.72, scale: 0.98 }}
      onPress={onPress}>
      <Ionicons
        name={active ? item.activeIcon : item.icon}
        size={21}
        color={active ? palette.accent : palette.textSecondary}
      />
      {compact ? null : (
        <Text
          color={active ? palette.accent : palette.text}
          fontSize={14.5}
          fontWeight={active ? "700" : "600"}
          numberOfLines={1}>
          {item.label}
        </Text>
      )}
    </XStack>
  );
}

/**
 * iPad 宽屏左侧导航栏（支持展开标签与窄图标 Rail 两种模式）。
 */
export function IPadSidebar({ width, compact }: { width: number; compact: boolean }) {
  const palette = usePalette();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();

  function isActive(item: NavItem): boolean {
    return item.matchPaths.includes(pathname);
  }

  return (
    <YStack
      width={width}
      height="100%"
      paddingTop={insets.top + 18}
      paddingBottom={Math.max(insets.bottom, 16) + 12}
      paddingHorizontal={compact ? 12 : 16}
      backgroundColor={palette.barSurface}
      borderRightWidth={StyleSheet.hairlineWidth}
      borderRightColor={palette.border}
      shadowColor={palette.dockShadow}
      shadowOpacity={isDark ? 0.18 : 0.05}
      shadowRadius={16}
      gap={22}>
      <XStack
        alignItems="center"
        justifyContent={compact ? "center" : "flex-start"}
        gap={10}
        paddingHorizontal={compact ? 0 : 10}>
        <View
          width={32}
          height={32}
          borderRadius={10}
          backgroundColor={palette.accent}
          alignItems="center"
          justifyContent="center">
          <Ionicons name="musical-notes" size={18} color={palette.onAccent} />
        </View>
        {compact ? null : (
          <Text color={palette.text} fontSize={18} fontWeight="800" letterSpacing={0.3}>
            MoeKoe
          </Text>
        )}
      </XStack>

      <YStack gap={4}>
        {compact ? null : (
          <Text
            color={palette.textTertiary}
            fontSize={11}
            fontWeight="700"
            paddingHorizontal={14}
            marginBottom={4}>
            浏览
          </Text>
        )}
        {PRIMARY_ITEMS.map((item) => (
          <SidebarRow
            key={item.key}
            item={item}
            active={isActive(item)}
            compact={compact}
            onPress={() => router.replace(item.route)}
          />
        ))}
      </YStack>

      <YStack gap={4}>
        {compact ? null : (
          <Text
            color={palette.textTertiary}
            fontSize={11}
            fontWeight="700"
            paddingHorizontal={14}
            marginBottom={4}>
            工具与设置
          </Text>
        )}
        {SHORTCUT_ITEMS.map((item) => (
          <SidebarRow
            key={item.key}
            item={item}
            active={isActive(item)}
            compact={compact}
            onPress={() => router.push(item.route)}
          />
        ))}
      </YStack>
    </YStack>
  );
}

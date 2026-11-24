import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, XStack, YStack } from "tamagui";

import { IPadSidebar } from "@/components/ui/ipad-sidebar";
import { MiniPlayer } from "@/components/ui/mini-player";
import { TabBarHeight, TabBarSideMargin } from "@/constants/layout";
import { useIsDark, usePalette } from "@/hooks/use-palette";
import { useResponsive } from "@/hooks/use-responsive";

type TabGlyph = "home" | "compass" | "person";

function TabItem({
  focused,
  glyph,
  label,
}: {
  focused: boolean;
  glyph: TabGlyph;
  label: string;
}) {
  const palette = usePalette();
  const tint = focused ? palette.accent : palette.textTertiary;

  return (
    <YStack alignItems="center" justifyContent="center" gap={3} minWidth={58} paddingTop={4}>
      <Ionicons name={focused ? glyph : (`${glyph}-outline` as const)} size={22} color={tint} />
      <Text color={tint} fontSize={10.5} fontWeight={focused ? "700" : "600"}>
        {label}
      </Text>
    </YStack>
  );
}

export default function TabsLayout() {
  const palette = usePalette();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const { width, isTablet, isWideTablet, sidebarWidth } = useResponsive();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const barHeight = TabBarHeight + insets.bottom;
  const contentAreaWidth = Math.max(280, width - sidebarWidth);
  const dockWidth = Math.min(contentAreaWidth - TabBarSideMargin * 2, isTablet ? 780 : 680);

  return (
    <XStack flex={1} backgroundColor={palette.background}>
      {isTablet ? <IPadSidebar width={sidebarWidth} compact={!isWideTablet} /> : null}

      <View style={styles.contentArea}>
        <Tabs
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: palette.background },
            tabBarShowLabel: false,
            tabBarHideOnKeyboard: true,
            tabBarStyle: isTablet
              ? { display: "none" }
              : {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: barHeight,
                  borderTopWidth: 0,
                  backgroundColor: palette.barSurface,
                  shadowColor: palette.dockShadow,
                  shadowOffset: { width: 0, height: 10 },
                  shadowOpacity: isDark ? 0.45 : 0.12,
                  shadowRadius: 22,
                  elevation: 10,
                  paddingTop: 6,
                  paddingBottom: insets.bottom,
                },
          }}>
          <Tabs.Screen
            name="index"
            options={{
              title: "首页",
              tabBarIcon: ({ focused }) => <TabItem focused={focused} glyph="home" label="首页" />,
            }}
          />
          <Tabs.Screen
            name="discover"
            options={{
              title: "发现",
              tabBarIcon: ({ focused }) => (
                <TabItem focused={focused} glyph="compass" label="发现" />
              ),
            }}
          />
          <Tabs.Screen
            name="me"
            options={{
              title: "我的",
              tabBarIcon: ({ focused }) => <TabItem focused={focused} glyph="person" label="我的" />,
            }}
          />
        </Tabs>

        {keyboardVisible ? null : (
          <View
            pointerEvents="box-none"
            style={[
              styles.dock,
              {
                bottom: isTablet ? Math.max(insets.bottom, 14) : barHeight + 8,
                width: dockWidth,
                marginLeft: (contentAreaWidth - dockWidth) / 2,
              },
            ]}>
            <MiniPlayer />
          </View>
        )}
      </View>
    </XStack>
  );
}

const styles = StyleSheet.create({
  contentArea: {
    flex: 1,
    position: "relative",
  },
  dock: {
    position: "absolute",
    left: 0,
  },
});

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MINI_PLAYER_HEIGHT } from "@/components/ui/mini-player";
import { TabBarHeight } from "@/constants/layout";
import { useHasTrack } from "@/features/player/store";
import { useResponsive } from "@/hooks/use-responsive";

/** 底部浮窗播放条和导航栏占据的安全区域，供滚动列表作为 paddingBottom。 */
export function useDockContentInset(): number {
  const insets = useSafeAreaInsets();
  const hasTrack = useHasTrack();
  const { isTablet } = useResponsive();

  if (isTablet) {
    return Math.max(insets.bottom, 14) + (hasTrack ? MINI_PLAYER_HEIGHT + 16 : 0) + 20;
  }

  return insets.bottom + TabBarHeight + (hasTrack ? MINI_PLAYER_HEIGHT + 10 : 0) + 20;
}

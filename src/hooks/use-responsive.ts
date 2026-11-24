import { useWindowDimensions } from "react-native";

export const TABLET_BREAKPOINT = 768;
export const WIDE_TABLET_BREAKPOINT = 1024;

export type ResponsiveInfo = {
  width: number;
  height: number;
  isLandscape: boolean;
  isTablet: boolean;
  isWideTablet: boolean;
  sidebarWidth: number;
  contentWidth: number;
  contentMaxWidth: number;
  getGridColumns: (minItemWidth?: number, maxColumns?: number) => number;
};

/**
 * 统一提供 iPad Pro / Split View / 台前调度下的响应式尺寸与断点信息。
 */
export function useResponsive(horizontalPadding = 32): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isTablet = width >= TABLET_BREAKPOINT;
  const isWideTablet = width >= WIDE_TABLET_BREAKPOINT;
  const sidebarWidth = isTablet ? (isWideTablet ? 216 : 84) : 0;
  const contentMaxWidth = isTablet ? 1200 : 800;
  const availableWidth = Math.max(280, width - sidebarWidth);
  const contentWidth = Math.min(availableWidth, contentMaxWidth) - horizontalPadding;

  function getGridColumns(minItemWidth = 156, maxColumns = 6): number {
    if (!isTablet) {
      return contentWidth >= 560 ? 3 : 2;
    }
    const cols = Math.floor((contentWidth + 14) / (minItemWidth + 14));
    return Math.max(2, Math.min(maxColumns, cols));
  }

  return {
    width,
    height,
    isLandscape,
    isTablet,
    isWideTablet,
    sidebarWidth,
    contentWidth,
    contentMaxWidth,
    getGridColumns,
  };
}

import { setAudioModeAsync } from "expo-audio";
import { useSyncExternalStore } from "react";

import { DEFAULT_ACCENT_ID, isAccentPresetId, type AccentPresetId } from "@/constants/accents";

import { readStoredAppearance, writeStoredAppearance } from "./storage";

export type ThemeMode = "system" | "light" | "dark";
export type AudioQuality = "128" | "320" | "flac";
export type LyricSizePreset = "sm" | "md" | "lg";

export type SettingsState = {
  hydrated: boolean;
  themeMode: ThemeMode;
  accentId: AccentPresetId;
  searchHistoryEnabled: boolean;
  preferredQuality: AudioQuality;
  lyricSize: LyricSizePreset;
  mixWithOthers: boolean;
};

const INITIAL_SETTINGS_STATE: SettingsState = {
  hydrated: false,
  themeMode: "system",
  accentId: DEFAULT_ACCENT_ID,
  searchHistoryEnabled: true,
  preferredQuality: "320",
  lyricSize: "md",
  mixWithOthers: true,
};

function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    getInitialState: () => initial,
    setState(partial: Partial<T>) {
      let changed = false;
      for (const key of Object.keys(partial) as (keyof T)[]) {
        if (!Object.is(state[key], partial[key])) {
          changed = true;
          break;
        }
      }

      if (!changed) {
        return;
      }

      state = { ...state, ...partial };
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const settingsStore = createStore(INITIAL_SETTINGS_STATE);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isAudioQuality(value: unknown): value is AudioQuality {
  return value === "128" || value === "320" || value === "flac";
}

function isLyricSizePreset(value: unknown): value is LyricSizePreset {
  return value === "sm" || value === "md" || value === "lg";
}

let hydrationPromise: Promise<void> | null = null;

/** 在根布局模块作用域调用一次;UI 由 hydrated 门控,不存在与用户操作的竞态。 */
export function hydrateSettings(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      const stored = await readStoredAppearance();
      settingsStore.setState({
        themeMode: stored && isThemeMode(stored.themeMode) ? stored.themeMode : "system",
        accentId: stored && isAccentPresetId(stored.accentId) ? stored.accentId : DEFAULT_ACCENT_ID,
        searchHistoryEnabled:
          stored && typeof stored.searchHistoryEnabled === "boolean"
            ? stored.searchHistoryEnabled
            : true,
        preferredQuality:
          stored && isAudioQuality(stored.preferredQuality) ? stored.preferredQuality : "320",
        lyricSize: stored && isLyricSizePreset(stored.lyricSize) ? stored.lyricSize : "md",
        mixWithOthers: stored && typeof stored.mixWithOthers === "boolean" ? stored.mixWithOthers : true,
        hydrated: true,
      });
    })().catch(() => {
      settingsStore.setState({ hydrated: true });
    });
  }
  return hydrationPromise;
}

function persist() {
  const { themeMode, accentId, searchHistoryEnabled, preferredQuality, lyricSize, mixWithOthers } =
    settingsStore.getState();
  void writeStoredAppearance({
    themeMode,
    accentId,
    searchHistoryEnabled,
    preferredQuality,
    lyricSize,
    mixWithOthers,
  });
}

export function getSettingsSnapshot(): SettingsState {
  return settingsStore.getState();
}

export const settingsActions = {
  setThemeMode(themeMode: ThemeMode) {
    settingsStore.setState({ themeMode });
    persist();
  },
  setAccentId(accentId: AccentPresetId) {
    settingsStore.setState({ accentId });
    persist();
  },
  setSearchHistoryEnabled(searchHistoryEnabled: boolean) {
    settingsStore.setState({ searchHistoryEnabled });
    persist();
  },
  setPreferredQuality(preferredQuality: AudioQuality) {
    settingsStore.setState({ preferredQuality });
    persist();
  },
  setLyricSize(lyricSize: LyricSizePreset) {
    settingsStore.setState({ lyricSize });
    persist();
  },
  setMixWithOthers(mixWithOthers: boolean) {
    settingsStore.setState({ mixWithOthers });
    persist();
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: mixWithOthers ? "mixWithOthers" : "doNotMix",
    });
  },
};

export function useSettings(): SettingsState {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getState,
    settingsStore.getInitialState
  );
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.getState().themeMode,
    () => INITIAL_SETTINGS_STATE.themeMode
  );
}

export function useAccentId(): AccentPresetId {
  return useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.getState().accentId,
    () => INITIAL_SETTINGS_STATE.accentId
  );
}

export function useSearchHistoryEnabled(): boolean {
  return useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.getState().searchHistoryEnabled,
    () => INITIAL_SETTINGS_STATE.searchHistoryEnabled
  );
}

export function useSettingsHydrated(): boolean {
  return useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.getState().hydrated,
    () => INITIAL_SETTINGS_STATE.hydrated
  );
}

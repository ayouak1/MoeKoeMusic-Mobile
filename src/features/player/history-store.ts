import { useSyncExternalStore } from "react";

import { readLocalJson, writeLocalJson } from "@/lib/local-store";

import type { PlayerTrack } from "./types";

export type PlayHistoryEntry = {
  track: PlayerTrack;
  playedAt: number;
};

const HISTORY_FILE = "moekoe-play-history.json";
const MAX_PLAY_HISTORY = 100;

let historyState: PlayHistoryEntry[] = [];
let hydrationPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function persist() {
  void writeLocalJson(HISTORY_FILE, historyState);
}

function isValidTrack(value: unknown): value is PlayerTrack {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj.hash === "string" && obj.hash.length > 0 && typeof obj.title === "string";
}

export const playHistoryActions = {
  hydrate(): Promise<void> {
    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        const stored = await readLocalJson<unknown>(HISTORY_FILE);
        if (Array.isArray(stored)) {
          historyState = stored
            .filter(
              (item): item is PlayHistoryEntry =>
                Boolean(item) &&
                typeof item === "object" &&
                typeof (item as PlayHistoryEntry).playedAt === "number" &&
                isValidTrack((item as PlayHistoryEntry).track)
            )
            .slice(0, MAX_PLAY_HISTORY);
        }
        emit();
      })().catch(() => undefined);
    }
    return hydrationPromise;
  },

  record(track: PlayerTrack) {
    if (!track.hash) {
      return;
    }
    const entry: PlayHistoryEntry = {
      track: { ...track },
      playedAt: Date.now(),
    };
    historyState = [
      entry,
      ...historyState.filter((item) => item.track.hash !== track.hash),
    ].slice(0, MAX_PLAY_HISTORY);
    emit();
    persist();
  },

  remove(hash: string) {
    const next = historyState.filter((item) => item.track.hash !== hash);
    if (next.length === historyState.length) {
      return;
    }
    historyState = next;
    emit();
    persist();
  },

  clear() {
    if (!historyState.length) {
      return;
    }
    historyState = [];
    emit();
    persist();
  },
};

export function usePlayHistory(): PlayHistoryEntry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => historyState,
    () => []
  );
}

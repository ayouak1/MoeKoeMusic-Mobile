import { useSyncExternalStore } from "react";

import { readLocalJson, writeLocalJson } from "@/lib/local-store";

const HISTORY_FILE = "moekoe-search-history.json";
const MAX_SEARCH_HISTORY = 30;

let historyState: string[] = [];
let hydrated = false;
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

export const searchHistoryActions = {
  hydrate(): Promise<void> {
    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        const stored = await readLocalJson<unknown>(HISTORY_FILE);
        if (Array.isArray(stored)) {
          historyState = stored
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .slice(0, MAX_SEARCH_HISTORY);
        }
        hydrated = true;
        emit();
      })().catch(() => {
        hydrated = true;
      });
    }
    return hydrationPromise;
  },

  add(keyword: string) {
    const trimmed = keyword.trim();
    if (!trimmed) {
      return;
    }
    const lower = trimmed.toLowerCase();
    historyState = [
      trimmed,
      ...historyState.filter((item) => item.toLowerCase() !== lower),
    ].slice(0, MAX_SEARCH_HISTORY);
    emit();
    persist();
  },

  remove(keyword: string) {
    const next = historyState.filter((item) => item !== keyword);
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

  isHydrated(): boolean {
    return hydrated;
  },
};

export function useSearchHistory(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => historyState,
    () => []
  );
}

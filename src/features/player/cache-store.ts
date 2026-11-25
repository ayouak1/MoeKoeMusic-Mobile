import { Directory, File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";

import type { AudioQuality } from "@/features/settings/store";
import { readLocalJson, writeLocalJson } from "@/lib/local-store";

import type { PlayerTrack } from "./types";

export type CachedTrackEntry = {
  hash: string;
  title: string;
  artist: string;
  filename: string;
  quality: AudioQuality;
  sizeBytes: number;
  cachedAt: number;
};

type CacheState = {
  entries: CachedTrackEntry[];
  downloadingHashes: string[];
};

const INDEX_FILE = "moekoe-offline-cache.json";
const CACHE_DIR_NAME = "offline-cache";

let cacheState: CacheState = {
  entries: [],
  downloadingHashes: [],
};
let hydrationPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function getCacheDir(): Directory {
  const dir = new Directory(Paths.document, CACHE_DIR_NAME);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

function persist() {
  void writeLocalJson(INDEX_FILE, cacheState.entries);
}

export const offlineCacheActions = {
  hydrate(): Promise<void> {
    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        const stored = await readLocalJson<unknown>(INDEX_FILE);
        if (Array.isArray(stored)) {
          const dir = getCacheDir();
          const valid = stored.filter((item): item is CachedTrackEntry => {
            if (!item || typeof item !== "object") return false;
            const entry = item as CachedTrackEntry;
            if (typeof entry.hash !== "string" || typeof entry.filename !== "string") return false;
            const file = new File(dir, entry.filename);
            return file.exists;
          });
          cacheState = { ...cacheState, entries: valid };
          emit();
        }
      })().catch(() => undefined);
    }
    return hydrationPromise;
  },

  getCachedUri(hash: string): string | null {
    const entry = cacheState.entries.find((item) => item.hash === hash);
    if (!entry) {
      return null;
    }
    const file = new File(getCacheDir(), entry.filename);
    return file.exists ? file.uri : null;
  },

  getCachedQuality(hash: string): AudioQuality | null {
    return cacheState.entries.find((item) => item.hash === hash)?.quality ?? null;
  },

  async downloadTrack(track: PlayerTrack, remoteUri: string, quality: AudioQuality): Promise<void> {
    if (!track.hash || !remoteUri) {
      return;
    }
    if (cacheState.downloadingHashes.includes(track.hash)) {
      return;
    }

    cacheState = {
      ...cacheState,
      downloadingHashes: [...cacheState.downloadingHashes, track.hash],
    };
    emit();

    try {
      const dir = getCacheDir();
      const ext = quality === "flac" || remoteUri.includes(".flac") ? "flac" : "mp3";
      const filename = `${track.hash}.${ext}`;
      const target = new File(dir, filename);
      const downloaded = await File.downloadFileAsync(remoteUri, target, { idempotent: true });
      const sizeBytes = downloaded.size || 0;

      const entry: CachedTrackEntry = {
        hash: track.hash,
        title: track.title,
        artist: track.artist,
        filename,
        quality,
        sizeBytes,
        cachedAt: Date.now(),
      };

      cacheState = {
        entries: [entry, ...cacheState.entries.filter((item) => item.hash !== track.hash)],
        downloadingHashes: cacheState.downloadingHashes.filter((h) => h !== track.hash),
      };
      emit();
      persist();
    } catch (error) {
      cacheState = {
        ...cacheState,
        downloadingHashes: cacheState.downloadingHashes.filter((h) => h !== track.hash),
      };
      emit();
      throw error;
    }
  },

  remove(hash: string) {
    const entry = cacheState.entries.find((item) => item.hash === hash);
    if (entry) {
      try {
        const file = new File(getCacheDir(), entry.filename);
        if (file.exists) {
          file.delete();
        }
      } catch {
        // 忽略删除异常
      }
    }
    cacheState = {
      ...cacheState,
      entries: cacheState.entries.filter((item) => item.hash !== hash),
    };
    emit();
    persist();
  },

  clear() {
    try {
      const dir = new Directory(Paths.document, CACHE_DIR_NAME);
      if (dir.exists) {
        dir.delete();
      }
    } catch {
      // 忽略目录清理异常
    }
    cacheState = { ...cacheState, entries: [] };
    emit();
    persist();
  },
};

export function useOfflineCache(): CacheState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => cacheState,
    () => cacheState
  );
}

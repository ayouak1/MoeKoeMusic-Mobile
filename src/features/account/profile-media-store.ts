import { Directory, File, Paths } from "expo-file-system";
import type { ImageSource } from "expo-image";
import { useSyncExternalStore } from "react";

import { readLocalJson, writeLocalJson } from "@/lib/local-store";

export type ProfilePresetKey = "anime-1" | "anime-2" | "anime-3";
export type ProfileMediaMode = "default" | ProfilePresetKey | "custom";

export type ProfileMediaState = {
  avatarMode: ProfileMediaMode;
  customAvatarUri: string | null;
  bgMode: ProfileMediaMode;
  customBgUri: string | null;
};

export type MediaPresetItem = {
  id: ProfilePresetKey;
  label: string;
  source: ImageSource;
};

export const AVATAR_PRESETS: readonly MediaPresetItem[] = [
  { id: "anime-1", label: "粉紫少女", source: require("../../../assets/profile/avatar-1.jpg") as ImageSource },
  { id: "anime-2", label: "霓虹少年", source: require("../../../assets/profile/avatar-2.jpg") as ImageSource },
  { id: "anime-3", label: "黑胶白猫", source: require("../../../assets/profile/avatar-3.jpg") as ImageSource },
];

export const BG_PRESETS: readonly MediaPresetItem[] = [
  { id: "anime-1", label: "樱花落日", source: require("../../../assets/profile/bg-1.jpg") as ImageSource },
  { id: "anime-2", label: "深夜工作室", source: require("../../../assets/profile/bg-2.jpg") as ImageSource },
  { id: "anime-3", label: "晴空碧海", source: require("../../../assets/profile/bg-3.jpg") as ImageSource },
];

const STORE_FILE = "moekoe-profile-media.json";
const MEDIA_DIR_NAME = "profile-media";

const INITIAL_STATE: ProfileMediaState = {
  avatarMode: "default",
  customAvatarUri: null,
  bgMode: "default",
  customBgUri: null,
};

let mediaState: ProfileMediaState = INITIAL_STATE;
let hydrationPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function persist() {
  void writeLocalJson(STORE_FILE, mediaState);
}

function getMediaDir(): Directory {
  const dir = new Directory(Paths.document, MEDIA_DIR_NAME);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

function isMediaMode(value: unknown): value is ProfileMediaMode {
  return (
    value === "default" ||
    value === "anime-1" ||
    value === "anime-2" ||
    value === "anime-3" ||
    value === "custom"
  );
}

function validateUri(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri) {
    return null;
  }
  try {
    const file = new File(uri);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

async function pickAndStoreImage(kind: "avatar" | "bg"): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: "image/*" });
  if (picked.canceled || !picked.result) {
    return null;
  }

  const source = picked.result;
  const extMatch = source.name?.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch?.[1]?.toLowerCase() || "jpg";
  const dir = getMediaDir();
  const target = new File(dir, `custom-${kind}-${Date.now()}.${ext}`);
  source.copy(target);
  return target.uri;
}

function removeOldCustomFile(oldUri: string | null) {
  if (!oldUri) return;
  try {
    const file = new File(oldUri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // 忽略旧文件清理异常
  }
}

export const profileMediaActions = {
  hydrate(): Promise<void> {
    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        const stored = await readLocalJson<Record<string, unknown>>(STORE_FILE);
        if (stored && typeof stored === "object") {
          const customAvatarUri = validateUri(stored.customAvatarUri);
          const customBgUri = validateUri(stored.customBgUri);
          const avatarMode = isMediaMode(stored.avatarMode) ? stored.avatarMode : "default";
          const bgMode = isMediaMode(stored.bgMode) ? stored.bgMode : "default";

          mediaState = {
            avatarMode: avatarMode === "custom" && !customAvatarUri ? "default" : avatarMode,
            customAvatarUri,
            bgMode: bgMode === "custom" && !customBgUri ? "default" : bgMode,
            customBgUri,
          };
          emit();
        }
      })().catch(() => undefined);
    }
    return hydrationPromise;
  },

  setAvatarMode(avatarMode: Exclude<ProfileMediaMode, "custom">) {
    mediaState = { ...mediaState, avatarMode };
    emit();
    persist();
  },

  setBgMode(bgMode: Exclude<ProfileMediaMode, "custom">) {
    mediaState = { ...mediaState, bgMode };
    emit();
    persist();
  },

  async pickCustomAvatar(): Promise<boolean> {
    const nextUri = await pickAndStoreImage("avatar");
    if (!nextUri) {
      return false;
    }
    const prevUri = mediaState.customAvatarUri;
    mediaState = {
      ...mediaState,
      avatarMode: "custom",
      customAvatarUri: nextUri,
    };
    emit();
    persist();
    if (prevUri && prevUri !== nextUri) {
      removeOldCustomFile(prevUri);
    }
    return true;
  },

  async pickCustomBg(): Promise<boolean> {
    const nextUri = await pickAndStoreImage("bg");
    if (!nextUri) {
      return false;
    }
    const prevUri = mediaState.customBgUri;
    mediaState = {
      ...mediaState,
      bgMode: "custom",
      customBgUri: nextUri,
    };
    emit();
    persist();
    if (prevUri && prevUri !== nextUri) {
      removeOldCustomFile(prevUri);
    }
    return true;
  },
};

export function useProfileMedia(): ProfileMediaState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => mediaState,
    () => INITIAL_STATE
  );
}

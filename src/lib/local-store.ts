import { File, Paths } from "expo-file-system";

/**
 * 在应用沙盒 Documents 目录读写轻量 JSON 数据（无 Keychain 2KB 限制，兼容 LiveContainer）。
 */
export async function readLocalJson<T>(filename: string): Promise<T | null> {
  try {
    const file = new File(Paths.document, filename);
    if (!file.exists) {
      return null;
    }
    const raw = await file.text();
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeLocalJson(filename: string, value: unknown): Promise<void> {
  try {
    const file = new File(Paths.document, filename);
    if (!file.exists) {
      file.create({ intermediates: true, overwrite: true });
    }
    file.write(JSON.stringify(value));
  } catch {
    // 忽略本地写入异常，保持内存态可用
  }
}

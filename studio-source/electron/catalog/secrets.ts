// API key 加密 —— 从 runtime.ts 拆出（见
// docs/plan/2026-06-04-runtime-split-execution.md 第 4 步）。
//
// safeStorage 走 OS 钥匙串（macOS Keychain / Windows DPAPI / Linux libsecret）。
// 生产环境不可用时拒绝新写入，避免 API key 明文落盘；旧明文记录仍可读取并懒升级。
import { safeStorage } from "electron";

export type ApiKeyRecord = {
  vendorKey: string;
  /** Key material. Encoding indicated by `enc`. Legacy v1 records have no `enc` and are plaintext. */
  apiKey: string;
  /** v2+: how the apiKey above is encoded. Absent = legacy plaintext (v1). */
  enc?: "safeStorage" | "plain";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export function isSafeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Build a fresh ApiKeyRecord from plaintext, encrypting if safeStorage is available. */
export function makeApiKeyRecordFromPlain(plain: string, vendorKey: string, enabled: boolean, createdAt: string, updatedAt: string): ApiKeyRecord {
  if (isSafeStorageAvailable()) {
    const encrypted = safeStorage.encryptString(plain).toString("base64");
    return { vendorKey, apiKey: encrypted, enc: "safeStorage", enabled, createdAt, updatedAt };
  }
  throw new Error("当前系统无法安全保存 API Key，请启用系统凭据存储后重试");
}

/** Decode an ApiKeyRecord to plaintext. Returns "" if a safeStorage-encoded value can't be decrypted. */
export function decryptApiKeyRecord(rec: ApiKeyRecord | undefined): string {
  if (!rec || !rec.apiKey) return "";
  if (rec.enc === "safeStorage") {
    try {
      return safeStorage.decryptString(Buffer.from(rec.apiKey, "base64"));
    } catch (e) {
      console.error(`[catalog] failed to decrypt API key for vendor ${rec.vendorKey}: ${e instanceof Error ? e.message : e}`);
      return "";
    }
  }
  // enc === "plain" or absent (legacy v1)
  return rec.apiKey;
}

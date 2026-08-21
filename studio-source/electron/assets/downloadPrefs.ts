// 下载偏好持久化 —— 记住用户上次「另存」到的目录，下次下载默认弹到那里。
// 痛点（fb-20260724）：每次下载都默认弹系统下载夹，用户要一遍遍手动导航到自己的工作目录。
// 只记「上次用过的目录」这一件事，存 userData/download-prefs.json（非用户数据、丢了也只是回退默认，无损）。
// 「为 Nomi 设固定下载目录」是另一件事（要设置页 UI），不在此处 —— 归 fb-20260729-settings-hub。
import fs from "node:fs";
import path from "node:path";
import { ensureDir, getSettingsRoot, readJson } from "../runtimePaths";

const PREFS_FILE = "download-prefs.json";

function prefsPath(): string {
  return path.join(getSettingsRoot(), PREFS_FILE);
}

export function getLastDownloadDir(): string {
  const prefs = readJson<{ lastDir?: string }>(prefsPath(), {});
  return typeof prefs.lastDir === "string" ? prefs.lastDir : "";
}

export function rememberDownloadDir(dir: string): void {
  const trimmed = String(dir || "").trim();
  if (!trimmed) return;
  try {
    ensureDir(getSettingsRoot());
    fs.writeFileSync(prefsPath(), JSON.stringify({ lastDir: trimmed }, null, 2), "utf8");
  } catch {
    /* 偏好持久化是 best-effort：写失败只是下次回退系统下载夹，不影响本次下载 */
  }
}

/**
 * 选另存对话框 defaultPath 的目录：上次用过且**仍存在**的目录优先，否则系统下载夹。
 * 纯函数（目录存在性由调用方注入），单测钉死「上次目录没了不会把用户带进死路径」。
 */
export function pickDownloadDir(lastDir: string, downloadsDir: string, dirExists: (dir: string) => boolean): string {
  const candidate = String(lastDir || "").trim();
  return candidate && dirExists(candidate) ? candidate : downloadsDir;
}

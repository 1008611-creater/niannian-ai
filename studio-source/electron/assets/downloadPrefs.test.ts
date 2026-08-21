// fb-20260724：下载记住上次目录。核心是 pickDownloadDir 的「上次目录没了→安全回退」不变量。
import { describe, expect, it } from "vitest";
import { pickDownloadDir } from "./downloadPrefs";

describe("pickDownloadDir（另存默认目录选择）", () => {
  const downloads = "/Users/x/Downloads";

  it("上次目录存在 → 用上次目录", () => {
    expect(pickDownloadDir("/Users/x/work", downloads, (d) => d === "/Users/x/work")).toBe("/Users/x/work");
  });

  it("上次目录已不存在 → 回退系统下载夹（不把用户带进死路径）", () => {
    expect(pickDownloadDir("/Users/x/gone", downloads, () => false)).toBe(downloads);
  });

  it("没有上次目录（空/空白）→ 系统下载夹，且不去 stat 空串", () => {
    let stated = false;
    const probe = (d: string) => {
      if (!d) stated = true;
      return true;
    };
    expect(pickDownloadDir("", downloads, probe)).toBe(downloads);
    expect(pickDownloadDir("   ", downloads, probe)).toBe(downloads);
    expect(stated).toBe(false);
  });
});

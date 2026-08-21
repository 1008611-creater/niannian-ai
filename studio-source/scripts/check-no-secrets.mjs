#!/usr/bin/env node
// ============================================================================
// 安全门岗：防「微信聊天记录 / db_key / 私有渠道配置」进 git（会 push 到公开 GitHub）。
//
// 为什么：反馈雷达持续产生微信群消息(raw.json/digest)、取钥产生 db_key(welive.yaml)，
//   都是高敏感隐私。gitignore 只是被动兜底——`git add -f` 能绕过，且**内容级泄露**（把群消息或
//   db_key 粘进某个 .md/.ts）它根本挡不住。本扫描器是主动门岗(shift-left)，被 3 处共用：
//     ① git pre-commit hook（scripts/git-hooks/pre-commit）→ 扫 staged，挡提交那一刻
//     ② pnpm run gates 的 check:secrets → 扫全仓 tracked，push 前兜底
//     ③ Claude PreToolUse hook（pre-push-check.sh）→ 挡 AI/定时 agent 手滑
//   对标 gitleaks/git-secrets 的 defense-in-depth，但轻量自包含、只认 Nomi 的敏感物、零依赖。
//
// 用法：
//   node scripts/check-no-secrets.mjs            扫 git staged（pre-commit 用）
//   node scripts/check-no-secrets.mjs --all      扫全部 tracked（gates / baseline 审计）
//   node scripts/check-no-secrets.mjs <file...>  扫指定文件
// 命中 → 打印详情 + exit 1（拦住）。干净 → exit 0。
// ============================================================================
import { execSync } from "node:child_process";
import fs from "node:fs";

// ── 路径黑名单：这些文件本身绝不该进 git ──
const FORBIDDEN_PATHS = [
  { re: /docs\/feedback\/.*-raw\.json$/, why: "微信/评论原始抓取数据" },
  { re: /docs\/feedback\/.*-digest\.md$/, why: "分诊日报（含用户原话/昵称）" },
  { re: /docs\/feedback\/sources\.json$/, why: "私有渠道配置（群名等）" },
  { re: /docs\/feedback\/state\.json$/, why: "去重状态" },
  { re: /(^|\/)welive\.ya?ml$/, why: "WeLive 配置（含 db_key）" },
  { re: /\.db$/, why: "数据库文件（可能是微信库）" },
  { re: /(^|\/)(all_)?keys?\.json$/, why: "取钥输出（含明文 db_key）" },
  { re: /wechat[-_]?export/i, why: "微信导出目录" },
];

// ── 白名单：放行（代码/文档/模板，含正则模式或占位示例，非真数据）──
const ALLOWLIST = [
  /docs\/feedback\/sources\.example\.json$/,
  /docs\/feedback\/README/i,
  /scripts\/check-no-secrets\.mjs$/, // 本扫描器（含正则定义）
  /scripts\/lib\/feedback\/dump_wechat_key\.py$/, // 取钥脚本（含正则模式，非真 hex）
  /scripts\/welive-setup-mac\.sh$/, // setup 脚本（含路径模式）
  /docs\/plan\/.*(feedback|radar).*\.md$/i, // 方案文档（讲取钥，含占位示例）
  /docs\/.*(security|安全).*\.md$/i, // 本安全系统文档
  /\.gitignore$/,
];

// ── 内容正则：防内容级泄露（路径没命中，但正文里粘了敏感物）──
// 注意：这些正则匹配的是「真实 hex/标识」，代码里的 `[0-9a-fA-F]{96}` 这类元字符不会命中。
const SECRET_PATTERNS = [
  { name: "微信 db_key（内存格式 x'...'）", re: /x'[0-9a-fA-F]{96}'/ },
  { name: "db_key 字段赋值", re: /\b(db_?key|dbkey|session_key)\b\s*[:=]\s*['"]?[0-9a-fA-F]{60,}/i },
  { name: "wxid 个人标识", re: /\bwxid_[a-z0-9]{8,}\b/ },
  { name: "微信群 id", re: /\b\d{6,}@chatroom\b/ },
  { name: "微信数据目录路径", re: /xwechat_files[/\\][^/\\]+[/\\]db_storage/ },
];

const isAllowed = (f) => ALLOWLIST.some((re) => re.test(f));

function listStaged() {
  try {
    return execSync("git diff --cached --name-only --diff-filter=AM", { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
function listAllTracked() {
  try {
    return execSync("git ls-files", { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
/** 读内容：staged 模式读 index 里的版本（git show :path），否则读工作区。跳过二进制。 */
function readContent(f, staged) {
  let raw;
  if (staged) {
    try { raw = execSync(`git show :"${f}"`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
    catch { raw = ""; }
  } else {
    try { raw = fs.readFileSync(f, "utf8"); } catch { raw = ""; }
  }
  return raw.includes("\u0000") ? "" : raw; // 含 NUL = 二进制，跳过内容扫描（路径黑名单仍生效）
}

function scan(files, staged) {
  const hits = [];
  for (const f of files) {
    if (isAllowed(f)) continue;
    for (const { re, why } of FORBIDDEN_PATHS) {
      if (re.test(f)) hits.push({ f, kind: "禁止路径", detail: why });
    }
    const content = readContent(f, staged);
    if (!content) continue;
    for (const { name, re } of SECRET_PATTERNS) {
      const m = content.match(re);
      if (m) hits.push({ f, kind: "内容命中", detail: `${name}（如 "${m[0].slice(0, 20)}…"）` });
    }
  }
  return hits;
}

// ── 主流程 ──
const args = process.argv.slice(2);
let files, mode, staged;
if (args.includes("--all")) { files = listAllTracked(); mode = "全部 tracked 文件"; staged = false; }
else if (args.length && !args[0].startsWith("--")) { files = args; mode = "指定文件"; staged = false; }
else { files = listStaged(); mode = "git staged 文件"; staged = true; }

const hits = scan(files, staged);

if (hits.length) {
  console.error("\n  🔴 安全门岗拦截：检测到疑似敏感数据（微信记录 / db_key / 私有配置）");
  console.error("  " + "─".repeat(56));
  for (const h of hits) console.error(`     ✗ ${h.f}\n         [${h.kind}] ${h.detail}`);
  console.error("  " + "─".repeat(56));
  console.error("  这些绝不能进 git（会 push 到公开 GitHub，且 git 历史永久留存）。处理：");
  console.error("     · 数据文件误 add → git rm --cached <file>（确认它已在 .gitignore）");
  console.error("     · 内容级泄露    → 删掉正文里的敏感串（db_key/群消息/wxid）");
  console.error("     · 确属误报      → 加进 scripts/check-no-secrets.mjs 的 ALLOWLIST");
  console.error("     · 已经提交了    → 见 docs/security/feedback-data-safety.md 的应急处理\n");
  process.exit(1);
}
console.log(`  ✓ 安全门岗通过：扫 ${files.length} 个${mode}，无微信记录/db_key/私有配置泄露。`);

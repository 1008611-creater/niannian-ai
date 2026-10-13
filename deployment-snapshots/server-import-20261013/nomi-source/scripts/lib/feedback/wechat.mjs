// Feedback Radar · 微信 adapter —— 经 per-db 手动解密（decrypt_wechat.py）只读导出群消息。
//
// 为什么是「手动解密」而不是 WeLive 二进制：微信 4.x 是 **per-db key**（每个 SQLCipher 库各自独立
// 密钥），WeLive CLI 的**单 db_key** 模型解不开当前库 → 报 status -3，被上层误判成「库钥失效」
// 而整渠道跳过——这正是连续多天 0 条微信信号的真因。decrypt_wechat.py 用 hook 到的 per-db keys
// （~/welive/wechat_keys.json）逐库 AES-256-CBC 手动解密，是真正能通的路。本 adapter 当它的只读壳：
// spawn python → 解析它吐的 JSON → 映射成 FeedbackSignal。
//
// 诚实边界：**只读**。decrypt_wechat.py 把明文库解到 /tmp、读完即删，绝不落 git；抓回的昵称/wxid
// 只进 raw.json（gitignore + check-no-secrets 双拦，绝不进公开仓）。从不往任何渠道发消息。
// 文本清洗（拆发言人前缀 / 滤 XML·系统·媒体消息）是纯函数，单测钉死；单一映射点 mapMessage。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECRYPT_PY = path.join(HERE, "decrypt_wechat.py");
const DEFAULT_KEYS = path.join(os.homedir(), "welive", "wechat_keys.json");

/**
 * decrypt_wechat.py 单群解密的进程超时（ms）。为什么必须有：解密走 spawn python，若 py 卡死
 * （库被微信独占锁 / hook 状态坏 / IO 挂起），无超时的 `await exec` 会**永不返回**、把整轮
 * feedback:radar 连同定时任务一起挂死（fb-20260726）。给有限超时 → 到点 Node SIGKILL 掉子进程、
 * exec reject，落进既有 catch 优雅跳过该群，不连累 GitHub/B站。默认 120s（实测 200 条 zstd 解压
 * 亚秒级，120s 是大宽松），可用 NOMI_WECHAT_DECRYPT_TIMEOUT_MS 调整；非法/过小值回落默认。纯函数。
 * @param {NodeJS.ProcessEnv} env
 * @returns {number} 有限正整数毫秒
 */
export function resolveDecryptTimeoutMs(env = process.env) {
  const raw = Number(env?.NOMI_WECHAT_DECRYPT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 5000 ? Math.floor(raw) : 120_000;
}

/**
 * 从一条导出文本里拆出 { author, body }。
 * 微信导出的每条消息形如 "wxid_xxx:\n正文" 或 "昵称:\n正文"（发言人前缀 + 换行 + 正文）；
 * 少数系统消息无前缀、直接是 <?xml...>。用非贪婪匹配定位**第一个** ":\n"（即发言人分隔符，
 * 正文里即便还含 ":\n" 也不误拆）；拆不出前缀时 author 留空、body=整段。前缀长度设上限 64
 * 防「正文恰好含 :\n」时把一大段正文当成作者。纯函数（无 IO），单测钉死。
 * @param {string} text
 * @returns {{author:string, body:string}}
 */
export function splitSenderPrefix(text = "") {
  const s = String(text);
  const m = s.match(/^([^\n]{1,64}?):\n([\s\S]*)$/);
  if (m) return { author: m[1].trim(), body: m[2] };
  return { author: "", body: s };
}

/**
 * 判断一段正文是「真人文本」（留）还是 XML/图片/撤回/系统/卡片消息（滤）。
 * 微信把图片/视频/位置/名片/小程序/撤回/入群提示都存成结构化 BLOB —— 解出来是
 * <?xml>/<msg>/<img>/<sysmsg>/<voipmsg>/<appmsg…> 开头的标记。分诊只认真人话，这些一律丢。
 * 判据：trim 后以 '<' 开头即结构化消息。（真人正文以 '<' 起头概率极低；反馈雷达宁可漏一条
 * 也不吞噪音——可接受的取舍。）
 * @param {string} body  已拆掉发言人前缀的正文
 * @returns {boolean}
 */
export function isHumanText(body = "") {
  const t = String(body).trim();
  if (!t) return false;
  if (t.startsWith("<")) return false; // <?xml / <msg> / <img / <sysmsg / <voipmsg / <appmsg …
  return true;
}

/**
 * decrypt_wechat.py 的一条消息 → FeedbackSignal（唯一映射点，字段随 py 输出变只改这里）。
 * 非真人文本返回 null（由调用方过滤）。create_time 是 unix 秒，转 ISO。
 * @param {{local_id?:(string|number), sender?:string, text?:string, create_time?:(string|number)}} m
 * @param {string} group  配置里的群名（做 sourceId 前缀 + context，不含 @chatroom 内部 id）
 * @returns {import("./normalize.mjs").FeedbackSignal|null}
 */
export function mapMessage(m, group) {
  const { author, body } = splitSenderPrefix(m?.text ?? "");
  const text = body.trim();
  if (!isHumanText(text)) return null;
  const ts = Number(m?.create_time);
  return {
    source: "wechat",
    sourceId: `${group}_${m?.local_id ?? ""}`, // local_id 仅群内唯一，拼群名保全局唯一（不外泄 @chatroom id）
    kind: "group_msg",
    author: author || m?.sender || "群友", // 前缀里的发言人；sender 恒空，仅作兜底
    text,
    url: "", // 微信无可点回的公开链接
    createdAt: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : "",
    context: `微信群「${group}」`,
  };
}

/** decrypt_wechat.py 只往 stdout 打一行 JSON（其余日志走 stderr）；取最后一行非空即那行 JSON。 */
function lastJsonLine(stdout) {
  const lines = String(stdout).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/**
 * @param {{pythonPath?:string, stateDir?:string, groups?:string[], sinceDays?:number}} cfg
 *        groups 填群名（decrypt_wechat.py 按子串匹配 contact 里的群昵称）；sinceDays 只看近 N 天。
 * @returns {Promise<{signals:import("./normalize.mjs").FeedbackSignal[], meta:object}>}
 */
export async function collectWechat(cfg = {}) {
  const groups = cfg.groups ?? [];
  if (!groups.length) return { signals: [], meta: { groups: 0, skipped: "未配置 wechat.groups" } };

  if (!fs.existsSync(DECRYPT_PY)) {
    return { signals: [], meta: { groups: groups.length, skipped: `decrypt_wechat.py 缺失(${DECRYPT_PY})` } };
  }

  // per-db key 文件：cfg.stateDir 优先，否则用默认 ~/welive/wechat_keys.json（并透传给 py）。
  const keysPath = cfg.stateDir ? path.join(cfg.stateDir, "wechat_keys.json") : DEFAULT_KEYS;
  if (!fs.existsSync(keysPath)) {
    return {
      signals: [],
      meta: { groups: groups.length, skipped: `缺 wechat_keys.json(${keysPath})——重取钥：bash scripts/welive-setup-mac.sh` },
    };
  }

  const python = cfg.pythonPath || process.env.NOMI_PYTHON || "python3";
  const sinceDays = cfg.sinceDays ?? 3;
  const cutoffMs = Date.now() - sinceDays * 86400_000;
  const env = { ...process.env, WECHAT_KEYS_PATH: keysPath };

  const all = [];
  const errors = [];
  let anyOk = false;
  for (const g of groups) {
    let stdout;
    try {
      ({ stdout } = await exec(python, [DECRYPT_PY, "--group", g], {
        maxBuffer: 64 * 1024 * 1024,
        env,
        // 有限超时 + SIGKILL：py 卡死时到点必被杀，绝不把整轮 radar 挂死（fb-20260726）。
        timeout: resolveDecryptTimeoutMs(env),
        killSignal: "SIGKILL",
      }));
    } catch (e) {
      // 超时（Node 到点杀子进程）单独报，比笼统「进程失败」更可行动。
      if (e?.killed && (e?.signal === "SIGKILL" || e?.code === "ETIMEDOUT")) {
        errors.push(`${g}: decrypt 超时(>${Math.round(resolveDecryptTimeoutMs(env) / 1000)}s)被杀，跳过本群（避免卡死整轮）`);
        continue;
      }
      // 进程级失败（python 缺失 / cryptography 未装 / 硬崩）——脱敏后带原文摘要，别吞真相。
      const safe = String(e?.stderr || e?.message || "").replace(/[0-9a-f]{32,}/gi, "<REDACTED>").replace(/\s+/g, " ").trim();
      errors.push(`${g}: decrypt 进程失败（${safe.slice(0, 120)}）`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(lastJsonLine(stdout));
    } catch {
      errors.push(`${g}: decrypt 输出非 JSON`);
      continue;
    }
    if (parsed.status !== "ok") {
      // no_group（群名没匹配上）/ explore（找到群但没读到消息）/ error（缺 keys）——带 py 的 message。
      errors.push(`${g}: ${parsed.status}（${String(parsed.message ?? "").slice(0, 80)}）`);
      continue;
    }
    anyOk = true;
    for (const m of parsed.messages ?? []) {
      const sig = mapMessage(m, g);
      if (!sig) continue; // 非真人文本
      const t = Date.parse(sig.createdAt);
      if (Number.isFinite(t) && t < cutoffMs) continue; // sinceDays 窗外
      all.push(sig);
    }
  }

  // 一个群都没解成功 → 整渠道优雅跳过（给可行动的错误汇总），不连累 GitHub/B站。
  if (!anyOk) {
    return { signals: [], meta: { groups: groups.length, skipped: errors.join("；") || "无群解密成功" } };
  }
  return { signals: all, meta: { groups: groups.length, messages: all.length, sinceDays, errors } };
}

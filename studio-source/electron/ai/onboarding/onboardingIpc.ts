import { ipcMain } from "electron";
import type { AiSdkProviderKind } from "../../catalog/types";
import { describeIllegalHeader, findIllegalHeader, findNonHeaderSafeChar, isJsonRecord, pickUpstreamMessage } from "../../jsonUtils";
import { guessModelKind } from "../../catalog/modelKindHeuristic";
import { parseModelListResponse } from "./modelListResponse";
import { normalizeProviderKind } from "../../catalog/catalogStore";
import { validateCredentialEndpoint } from "../../secureEndpoint";

// ---------------------------------------------------------------------------
// Onboarding — 中转拉取式接入 IPC（手填地址+key → 拉模型 → 按 id 分类 → 保存）。
// 「AI 读文档」子系统已下线（Issue #8：各家中转参数不一，读文档抠参数不可靠）。
// ---------------------------------------------------------------------------

/** 单协议探测结果。mismatch=true 表示像「路由/协议不对」（可换下一个协议试）。 */
type ProtocolProbe = { ok: boolean; status?: number; error?: string; mismatch?: boolean };

async function describeNetworkErrorLazy(error: unknown): Promise<string> {
  const { describeNetworkError } = await import("../../systemProxy");
  return describeNetworkError(error);
}

/** 上游失败体 → 那句人话。键优先级表住 jsonUtils（全仓唯一），挑不出来才退回原文/HTTP 码。 */
function upstreamErrorText(bodyText: string, status: number): string {
  let parsed: unknown;
  try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch { parsed = null; }
  const said = isJsonRecord(parsed) ? pickUpstreamMessage(parsed) : "";
  return said || bodyText.trim().slice(0, 300) || `HTTP ${status}`;
}

/** payload.headers（用户自填的中转请求头）→ 干净的 kv。三个 handler 共用。 */
function readExtraHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = String(k).trim();
      const value = String(v ?? "").trim();
      if (key && value) out[key] = value;
    }
  }
  return out;
}

/** 按协议给鉴权头（anthropic 用 x-api-key + 版本；其余 Bearer）。拉模型/可达性探测共用。 */
function buildAuthHeaders(
  providerKind: AiSdkProviderKind,
  apiKey: string,
  extraHeaders: Record<string, string>,
): Record<string, string> {
  return providerKind === "anthropic"
    ? { "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}), ...extraHeaders }
    : { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders };
}

/**
 * 拉这个上游开放的模型列表。候选 URL：openai-compatible 的 baseUrl 通常已含 /v1 → /models；
 * 但很多 new-api 后台给的是**裸地址**——那样 /models 会 404 或（更坑）被后台 SPA 200 回一页
 * index.html。所以依次试 /models 与 /v1/models，且**命中判据是「解析得出模型列表」而不是
 * 「HTTP 200」**（只看 200 会被 SPA 骗到提前收工，真正对的 /v1/models 永远轮不到）。
 * list-models 与「测试连接」的可达性探测共用这一条，不各写一份（P1）。
 */
async function fetchModelList(
  providerKind: AiSdkProviderKind,
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<{ ok: true; models: string[] } | { ok: false; status?: number; error: string }> {
  const candidates =
    providerKind === "anthropic"
      ? [`${baseUrl}/v1/models`]
      : [`${baseUrl}/models`, `${baseUrl}/v1/models`];
  let lastErr = "";
  let lastStatus: number | undefined;
  // 某候选回了「合法但空」的列表：先记下，仍继续试下一个候选（可能那个才有货）；全试完还是空，
  // 才如实报「这个地址确实没列出模型」。
  let sawEmptyList = false;
  for (const url of candidates) {
    let res: Response;
    try { res = await fetch(url, { method: "GET", headers, signal }); }
    catch (e) { lastErr = await describeNetworkErrorLazy(e); continue; }
    const text = await res.text().catch(() => "");
    if (!res.ok) { lastStatus = res.status; lastErr = upstreamErrorText(text, res.status); continue; }
    const models = parseModelListResponse(text);
    if (models === null) { lastStatus = res.status; lastErr = `${url} 返回的不是模型列表（像是网页）`; continue; }
    if (models.length === 0) { sawEmptyList = true; continue; }
    return { ok: true, models };
  }
  if (sawEmptyList) return { ok: true, models: [] };
  return { ok: false, status: lastStatus, error: lastErr || "拉取不到模型列表" };
}

/**
 * 用极小请求体探测一个 wire protocol 是否接受。三协议各自的 URL/认证/body 形状：
 *  - anthropic        : host root + /v1/messages，x-api-key + anthropic-version，messages 体（剥尾随 /v1 防双拼）
 *  - openai-responses : {baseUrl}/responses，bearer，{input, max_output_tokens}（非 messages！）
 *  - openai-compatible: {baseUrl}/chat/completions，bearer，{messages, max_tokens}
 */
async function probeOneProtocol(
  kind: AiSdkProviderKind,
  rawBaseUrl: string,
  apiKey: string,
  modelId: string,
  extraHeaders: Record<string, string>,
  signal: AbortSignal,
): Promise<ProtocolProbe> {
  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;
  if (kind === "anthropic") {
    const root = (rawBaseUrl || "https://api.anthropic.com").replace(/\/v1$/i, "");
    url = `${root}/v1/messages`;
    headers = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...extraHeaders,
    };
    body = { model: modelId || "claude-3-5-haiku-latest", max_tokens: 1, messages: [{ role: "user", content: "ping" }] };
  } else if (kind === "openai-responses") {
    url = `${rawBaseUrl}/responses`;
    headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders };
    body = { model: modelId || "gpt-4o-mini", input: "ping", max_output_tokens: 16 };
  } else {
    url = `${rawBaseUrl}/chat/completions`;
    headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders };
    body = { model: modelId || "gpt-3.5-turbo", messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
  }
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    // 404/405/501/502/503 多为「路由/协议不对」→ 换下一个协议；401/403/400 多为鉴权/请求问题（不是协议错）。
    const mismatch = [404, 405, 501, 502, 503].includes(res.status);
    return { ok: false, status: res.status, error: upstreamErrorText(text, res.status), mismatch };
  } catch (error) {
    return { ok: false, error: await describeNetworkErrorLazy(error), mismatch: true };
  }
}

export function registerOnboardingIpc(): void {
  // 「AI 读文档」接入路径已下线（Issue #8：改为中转拉取式接入图片/视频/文本）。

  // PRIMARY model-adding path — manual provider entry (BaseURL + key + models).
  // Deterministic openai-compatible text commit; reuses the single catalog write
  // path. No forced connectivity test (aligns with opencode; see test-connection).
  ipcMain.handle("nomi:onboarding:manual-commit", async (_event, payload: Record<string, unknown>) => {
    try {
      // R1：走唯一 normalizeProviderKind（接受 openai-responses），不再 2 值 clamp。
      const providerKind = normalizeProviderKind(payload?.providerKind);
      const { commitManualOpenAiCompatibleModels } = await import("../../catalog/catalogCommit");
      const { smartDefaultImageEditProtocol } = await import("../../catalog/newapiTransport");
      const { probeImageEditProtocol } = await import("../../catalog/imageEditProbe");
      const headers: Record<string, string> = {};
      if (payload?.headers && typeof payload.headers === "object") {
        for (const [k, v] of Object.entries(payload.headers as Record<string, unknown>)) {
          headers[String(k)] = String(v ?? "");
        }
      }
      const baseUrl = String(payload?.baseUrl || "").trim();
      const apiKey = String(payload?.apiKey || "").trim();
      const rawModels = Array.isArray(payload?.models) ? (payload.models as Array<Record<string, unknown>>) : [];
      // 改图协议判定（探测优先 → 智能默认 → chat 兜底）。只对**图片模型且智能默认落 chat（歧义）**的做免费
      // 探测（gpt-image/dall-e/grok 已由智能默认判定、无需探）；用户/UI 显式给了 imageEditProtocol 则直接用。
      // 探测发 multipart 缺 image 的请求读报错形状，**不触发付费生成**；带超时兜底，永不阻塞保存。
      // 原生报文探测（每个 probePath 只探一次，结果在本次提交内复用）：模型命中内置档案且这家中转
      // 真提供该档案的原生端点 → 用那份完整报文而不是通用最小模板。探测只发 GET、不建任务、不计费。
      const { archetypeIdForModel } = await import("../../catalog/archetypeIdentity");
      const { nativeWireProfileForArchetype } = await import("../../catalog/nativeWireProfiles");
      const { probeNativeEndpoint } = await import("../../catalog/nativeEndpointProbe");
      const nativeProbeCache = new Map<string, Promise<boolean>>();
      const nativeArchetypeIdFor = async (id: string): Promise<string | undefined> => {
        const archetypeId = archetypeIdForModel(id);
        const profile = nativeWireProfileForArchetype(archetypeId);
        if (!profile) return undefined;
        let pending = nativeProbeCache.get(profile.probePath);
        if (!pending) {
          pending = probeNativeEndpoint(baseUrl, profile.probePath, apiKey).then((r) => r.exists).catch(() => false);
          nativeProbeCache.set(profile.probePath, pending);
        }
        return (await pending) ? profile.archetypeId : undefined;
      };
      const models = await Promise.all(rawModels.map(async (m) => {
        const id = String(m?.id || "");
        const k = m?.kind;
        const kind = (k === "image" || k === "video" || k === "text" || k === "audio" ? k : undefined) as "text" | "image" | "video" | "audio" | undefined;
        const displayName = m?.displayName ? String(m.displayName) : undefined;
        const explicit = typeof m?.imageEditProtocol === "string" ? (m.imageEditProtocol as "chat-completions-image-url" | "xai-json-edits" | "openai-multipart-edits") : undefined;
        const effectiveKind = kind || (id ? guessModelKind(id) : undefined);
        if (effectiveKind === "video" && id) {
          const nativeWireArchetypeId = await nativeArchetypeIdFor(id);
          return { id, displayName, kind, ...(nativeWireArchetypeId ? { nativeWireArchetypeId } : {}) };
        }
        if (effectiveKind !== "image" || !id) return { id, displayName, kind };
        if (explicit) return { id, displayName, kind, imageEditProtocol: explicit };
        if (smartDefaultImageEditProtocol(id) !== "chat-completions-image-url") return { id, displayName, kind };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        try {
          const probed = await probeImageEditProtocol({ baseUrl, apiKey, modelKey: id, headers, signal: controller.signal });
          return probed ? { id, displayName, kind, imageEditProtocol: probed } : { id, displayName, kind };
        } finally {
          clearTimeout(timer);
        }
      }));
      const result = commitManualOpenAiCompatibleModels({
        vendorName: String(payload?.vendorName || ""),
        baseUrl,
        apiKey,
        providerKind,
        headers,
        models,
      });
      return { ok: true, vendorKey: result.vendorKey, committed: result.committed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });

  // 类型启发式（Issue #8）：从 /v1/models 拉到/手填的模型 id 没带类型，主进程按关键词猜
  // 图片/视频/文本（单一真相源 guessModelKind），返回给 UI 预填「类型」下拉，用户可改。
  ipcMain.handle("nomi:onboarding:guess-kinds", async (_event, payload: Record<string, unknown>) => {
    const ids = Array.isArray(payload?.ids) ? (payload.ids as unknown[]).map((x) => String(x || "")) : [];
    const kinds: Record<string, "text" | "image" | "video" | "audio"> = {};
    for (const id of ids) if (id) kinds[id] = guessModelKind(id);
    return { kinds };
  });

  // 接口协议探测（auto-probe）+ 连接测试。非阻塞，永不 gate 保存。
  // 真实用户接不进来的根因是「不知道选哪个协议」（P4）——默认让主进程替他试：
  // chat↔responses 共享 /v1 baseURL + bearer，只 path/body 不同，挨个发极小请求探测；
  // anthropic（host root + x-api-key）仅当 hostname 像 anthropic 或地址留空时纳入。
  // 专家在表单展开「接口协议」强制指定时，payload.providerKind 给定 → 只测那一个。
  ipcMain.handle("nomi:onboarding:test-connection", async (_event, payload: Record<string, unknown>) => {
    const rawBaseUrl = String(payload?.baseUrl || "").trim().replace(/\/+$/, "");
    const apiKey = String(payload?.apiKey || "").trim();
    const modelId = String(payload?.modelId || "").trim();
    const forcedKind = payload?.providerKind ? normalizeProviderKind(payload.providerKind) : undefined;
    const autoProbe = payload?.autoProbe === true && !forcedKind;
    // 「接口协议」只管**文本**模型怎么发聊天；图片/视频走 mapping 的自有端点（如 new-api 的
    // /v1/video/generations），压根不读 providerKind。所以当用户一个文本模型都没选时（纯图片/
    // 视频中转），拿模型 id 去发 chat/completions 必然被上游拒——那是我们探错了，不是他接不通。
    // 这种情况改探「地址+Key 通不通」：GET /models 成功即通（零成本、不需要任何模型 id）。
    const reachabilityOnly = payload?.probe === "reachability";
    // User-supplied relay/proxy headers replay on every probe so a gateway that gates
    // on them doesn't report a false failure.
    const extraHeaders = readExtraHeaders(payload?.headers);
    // 发送前请求头守卫（与 vendorHttp.requestJson 同一判据/措辞）：这条 handler 自带裸 fetch，
    // 不经发送闸——脏 key（含中文/全角）会让 fetch 同步抛原始 ByteString，被 describeNetworkError
    // 误判网络。先识别、说人话、根本不发 fetch（治本，避免「连不上：Cannot convert…」）。
    const keyProblem = apiKey ? findNonHeaderSafeChar(apiKey) : null;
    if (keyProblem) return { ok: false, error: describeIllegalHeader({ name: "API Key", ...keyProblem }).message };
    const headerProblem = findIllegalHeader(extraHeaders);
    if (headerProblem) return { ok: false, error: describeIllegalHeader(headerProblem).message };
    // 纯图片/视频上游：不探协议（探了也白探，它们不走 providerKind），只探地址+Key 通不通。
    if (reachabilityOnly) {
      let validatedBaseUrl: string;
      try {
        validatedBaseUrl = validateCredentialEndpoint(rawBaseUrl);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      const kind = forcedKind ?? "openai-compatible";
      const headers = buildAuthHeaders(kind, apiKey, extraHeaders);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const listed = await fetchModelList(kind, validatedBaseUrl, headers, controller.signal);
        return listed.ok
          ? { ok: true, reachabilityOnly: true }
          : { ok: false, status: listed.status, error: listed.error };
      } finally {
        clearTimeout(timeout);
      }
    }
    // 候选协议：强制 → 只它；自动 → chat+responses（+anthropic 当 hostname 像 anthropic 或地址留空）。
    let candidates: AiSdkProviderKind[];
    if (forcedKind) {
      candidates = [forcedKind];
    } else if (autoProbe) {
      const host = (() => {
        try { return new URL(rawBaseUrl).hostname; } catch { return ""; }
      })();
      const anthropicLikely = !rawBaseUrl || /anthropic|claude/i.test(host);
      candidates = !rawBaseUrl
        ? ["anthropic"]
        : anthropicLikely
          ? ["anthropic", "openai-compatible", "openai-responses"]
          : ["openai-compatible", "openai-responses"];
    } else {
      candidates = ["openai-compatible"];
    }
    // openai-* 必须有 http(s) 地址；anthropic 可留空（托管默认）。无地址且无 anthropic 候选 → 直接报错。
    let validatedBaseUrl = rawBaseUrl;
    if (!candidates.includes("anthropic") || rawBaseUrl) {
      try {
        validatedBaseUrl = validateCredentialEndpoint(rawBaseUrl);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      let best: (ProtocolProbe & { kind: AiSdkProviderKind }) | null = null;
      for (const kind of candidates) {
        // openai-* 没地址就跳过（避免 fetch 无效 URL）。
        if (kind !== "anthropic" && !validatedBaseUrl) continue;
        const r = await probeOneProtocol(kind, validatedBaseUrl, apiKey, modelId, extraHeaders, controller.signal);
        if (r.ok) return { ok: true, status: r.status, detectedKind: kind };
        // 留住「最该报给用户」的错：非 mismatch（鉴权/请求错，可操作）优先于 mismatch（换协议）。
        if (!best || (best.mismatch && !r.mismatch)) best = { ...r, kind };
      }
      return { ok: false, status: best?.status, error: best?.error || "连接失败", detectedKind: forcedKind };
    } finally {
      clearTimeout(timeout);
    }
  });

  // Auto-discover the endpoint's models via the standard list-models call, so the
  // user picks from real model ids instead of guessing/typing. Relays are usually
  // OpenAI-compatible and expose this; when they don't, the UI falls back to manual
  // id entry (this just returns ok:false and nothing is blocked).
  ipcMain.handle("nomi:onboarding:list-models", async (_event, payload: Record<string, unknown>) => {
    // R1：唯一归一化器。openai-responses 与 openai-compatible 一样走 GET {baseUrl}/models。
    const providerKind = normalizeProviderKind(payload?.providerKind);
    const rawBaseUrl = String(payload?.baseUrl || "").trim().replace(/\/+$/, "");
    const baseUrl =
      providerKind === "anthropic" && !rawBaseUrl ? "https://api.anthropic.com" : rawBaseUrl;
    const apiKey = String(payload?.apiKey || "").trim();
    let validatedBaseUrl: string;
    try {
      validatedBaseUrl = validateCredentialEndpoint(baseUrl);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const extraHeaders = readExtraHeaders(payload?.headers);
    const headers = buildAuthHeaders(providerKind, apiKey, extraHeaders);
    // 发送前请求头守卫（同 test-connection）：自带裸 fetch 绕过发送闸，脏 key 先拦+说人话，不发 fetch。
    const headerProblem = findIllegalHeader(headers);
    if (headerProblem) return { ok: false, error: describeIllegalHeader(headerProblem).message };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      return await fetchModelList(providerKind, validatedBaseUrl, headers, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  });
}

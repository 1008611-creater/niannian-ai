// 厂商任务响应解析 —— 从 runtime.ts 拆出（见
// docs/plan/2026-06-04-runtime-split-execution.md 第 2 步）。
// 把各家 provider 返回的任意 JSON 结构按映射表抽取资产 URL / 状态 / 元数据。
// 纯函数、无副作用、最易出 bug ——本模块的核心价值就是为它补上 characterization 测试。
import { extractTaskId as extractTaskIdShared } from "../ai/requestPipeline";
import { firstString, isJsonRecord, readNestedRecord, trim, type JsonRecord } from "../jsonUtils";

/** 与 runtime 的 TaskResult["status"] 结构等价，解耦类型依赖。 */
export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export function maybeParseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

export function pathValues(input: unknown, expression: string): unknown[] {
  const parts = expression.split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown[] = [input];
  for (const part of parts) {
    const wildcard = part.endsWith("[*]");
    const key = wildcard ? part.slice(0, -3) : part;
    const next: unknown[] = [];
    for (const rawItem of current) {
      const item = maybeParseJsonString(rawItem);
      let value: unknown;
      if (/^\d+$/.test(key) && Array.isArray(item)) {
        value = item[Number(key)];
      } else if (key && isJsonRecord(item)) {
        value = item[key];
      } else {
        value = item;
      }
      if (wildcard) {
        const parsed = maybeParseJsonString(value);
        if (Array.isArray(parsed)) next.push(...parsed);
      } else if (typeof value !== "undefined") {
        next.push(value);
      }
    }
    current = next;
  }
  return current;
}

export function mappingCandidates(mapping: JsonRecord | null, key: string): string[] {
  const raw = mapping?.[key];
  if (Array.isArray(raw)) return raw.map((item) => String(item || "").trim()).filter(Boolean);
  const direct = firstString(raw);
  return direct ? [direct] : [];
}

export function valuesFromMapping(response: unknown, mapping: JsonRecord | null, key: string): unknown[] {
  return mappingCandidates(mapping, key).flatMap((candidate) => pathValues(response, candidate));
}

export function firstMappedString(response: unknown, mapping: JsonRecord | null, key: string): string {
  return firstString(...valuesFromMapping(response, mapping, key));
}

export function collectAssetUrls(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return /^(https?:\/\/|data:|nomi-local:\/\/)/i.test(text) ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap(collectAssetUrls);
  if (isJsonRecord(value)) {
    return [
      value.url,
      value.video_url,
      value.image_url,
      value.model_url,
      value.output_url,
      value.thumbnailUrl,
    ].flatMap(collectAssetUrls);
  }
  return [];
}

export function taskStatusFromResponse(response: unknown, responseMapping: JsonRecord | null, statusMapping: Record<string, string[]> | undefined, assetUrls: string[]): TaskStatus {
  const mappedStatus = firstMappedString(response, responseMapping, "status");
  const fallbackStatus = firstString(
    mappedStatus,
    isJsonRecord(response) ? response.status : "",
    isJsonRecord(response) ? readNestedRecord(response, ["data", "status"]) : "",
    isJsonRecord(response) ? readNestedRecord(response, ["choices", "0", "finish_reason"]) : "",
  ).toLowerCase();
  const sm = statusMapping || {};
  for (const status of ["queued", "running", "succeeded", "failed"] as const) {
    const values = Array.isArray(sm[status]) ? sm[status] : [];
    if (values.map((item) => String(item).toLowerCase()).includes(fallbackStatus)) return status;
  }
  // 通用状态词表（供应商无关）。kie 用 waiting/generating/fail，故并入默认 —— 让所有走这套
  // 动词的供应商无需各自声明 statusMapping（避免每家一份并行映射）。
  if (["queued", "queuing", "pending", "waiting", "in_queue", "starting"].includes(fallbackStatus)) return "queued";
  if (["running", "processing", "in_progress", "generating"].includes(fallbackStatus)) return "running";
  if (["succeeded", "success", "completed", "complete", "done", "stop", "length"].includes(fallbackStatus)) return "succeeded";
  if (["failed", "fail", "error", "timeout", "expired", "canceled", "cancelled"].includes(fallbackStatus)) return "failed";
  if (assetUrls.length > 0) return "succeeded";
  if (isJsonRecord(response) && (response.error || readNestedRecord(response, ["data", "error"]))) return "failed";
  return "queued";
}

/** 各家把失败原因塞进的字段名（无序扫描用）。含 kie 的 failMsg、runninghub 的 errorMessage。 */
const FAILURE_TEXT_KEYS = [
  "error_message",
  "errorMessage",
  "failMsg",
  "fail_reason",
  "failureReason",
  "message",
  "detail",
  "reason",
] as const;
/** 递归下钻的容器字段（`error` 必须在内——它常是对象 `{code,message}`，不是字符串）。 */
const FAILURE_NEST_KEYS = ["error", "data", "raw", "response", "result", "output", "errors"] as const;
/** 成功态占位词：`{code:200,message:"success",data:{…}}` 这种包裹别被当成失败原因报给用户。 */
const NON_FAILURE_TEXTS = new Set(["success", "succeeded", "ok", "done", "成功", "完成"]);

function failureTextByShape(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  const node = maybeParseJsonString(value);
  if (typeof node === "string") {
    const text = node.trim();
    return NON_FAILURE_TEXTS.has(text.toLowerCase()) ? "" : text;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = failureTextByShape(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (!isJsonRecord(node)) return "";
  for (const key of FAILURE_TEXT_KEYS) {
    const text = trim(node[key]);
    if (text && !NON_FAILURE_TEXTS.has(text.toLowerCase())) return text;
  }
  for (const key of FAILURE_NEST_KEYS) {
    if (!(key in node)) continue;
    const found = failureTextByShape(node[key], depth + 1);
    if (found) return found;
  }
  return "";
}

/**
 * 终态失败的**真实原因**（唯一读点）。
 *
 * 病根（2026-07-30 用户真机报「模型任务执行失败 (taskId=…, kind=text_to_image)」）：16 份 profile 的
 * `response_mapping.error_message` 声明了失败原因在哪（apimart `data.error.message` / kie `data.failMsg` /
 * runninghub `errorMessage` / modelscope `errors.message` …），但**全程没有任何一处读它**——声明即死代码。
 * 渲染层只好自己按形状猜，且猜不到 failMsg/errorMessage 这类家族专属字段，于是所有 vendor 的终态失败
 * 统统退化成一句「模型任务执行失败 + taskId」：用户看不到能行动的信息，我们也拿不到真原因。
 *
 * 顺序：① profile 声明的映射（每家自己的路径，权威）→ ② 映射没声明/没取到才按常见形状下钻。
 * 两层都在这一个函数里，渲染层不再自己解析（删掉了那份猜形状的副本）。
 *
 * 上游 JSON 常被当字符串二次嵌套（apimart 把 Google 的 `{"error":{"code":404,…}}` 整个塞进
 * `data.error.message`），故取到文本后再解一层——否则用户看到的是一坨转义 JSON 而非「Requested
 * entity was not found.」。
 */
export function taskFailureMessageFromResponse(response: unknown, responseMapping: JsonRecord | null): string {
  const mapped = firstMappedString(response, responseMapping, "error_message");
  const text = mapped || failureTextByShape(response);
  if (!text) return "";
  return failureTextByShape(text) || text;
}

export function providerMetaFromResponse(response: unknown, mapping: JsonRecord | null): JsonRecord {
  const meta: JsonRecord = {};
  if (mapping) {
    for (const key of Object.keys(mapping)) {
      const value = firstMappedString(response, mapping, key);
      if (value) meta[key] = value;
    }
  }
  const taskId = firstString(meta.query_id, meta.task_id, extractTaskIdShared(response));
  if (taskId) {
    meta.query_id = meta.query_id || taskId;
    meta.task_id = meta.task_id || taskId;
  }
  return meta;
}

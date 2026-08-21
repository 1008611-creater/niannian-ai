// 可执行模型解析（vendor 启用 + 模型启用 + key 解密）——从 runtime.ts 下沉（R12 净减，
// 依赖全在 catalog 域）；runtime re-export 保住 textTaskRunner/taskResultQuery 既有 import 面。
import { readCatalog } from "./catalogStore";
import { decryptApiKeyRecord } from "./secrets";
import { selectExecutableModel, type BillingModelKind } from "./types";
import type { Model, Vendor } from "./types";

export function findExecutableModel(
  vendorKey: string,
  modelKey: string,
  kind?: BillingModelKind,
): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  const vendor = state.vendors.find((item) => item.key === vendorKey && item.enabled);
  if (!vendor) throw new Error(`Vendor is not enabled: ${vendorKey}`);
  // 精确 modelKey 优先于 alias（修双键 OR 误路由，selectExecutableModel 纯函数单测覆盖）。
  const model = selectExecutableModel(state.models, vendorKey, modelKey, kind);
  // 分两种说法（旧实现都压成一句英文 `Model is not enabled`，落进 unknown 桶 → 用户看到技术原话 +
  // 误导的「稍等重试」）：记录**整条不在了** = 已退役下线（我们主动移除，见 seedBuiltins 退役清单）
  // → 渲染层归 model-retired、给「换个模型」；记录还在只是被停用 → 归 model-config、给「去模型接入」。
  if (!model) {
    const known = state.models.some(
      (item) => item.vendorKey === vendorKey && (item.modelKey === modelKey || item.modelAlias === modelKey),
    );
    throw new Error(known ? `Model is not enabled: ${modelKey}` : `Model is retired: ${modelKey}`);
  }
  const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[vendorKey]);
  if (vendor.authType !== "none" && !apiKey) throw new Error(`API key missing: ${vendorKey}`);
  return { vendor, model, apiKey };
}

export function findExecutableModelForTask(
  vendorKey: string,
  modelKey: string,
  kind: BillingModelKind,
): { vendor: Vendor; model: Model; apiKey: string } {
  if (modelKey) return findExecutableModel(vendorKey, modelKey, kind);
  const state = readCatalog();
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.enabled && item.kind === kind);
  if (!model) throw new Error(`No enabled ${kind} model for vendor: ${vendorKey}`);
  return findExecutableModel(vendorKey, model.modelKey, kind);
}

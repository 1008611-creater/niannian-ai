// 请求参数构建（从 runtime.ts 抽出，评审 M5：可测 + 不喂大 runtime）。
// 把一个 TaskRequest 摊平成模板引擎要的 `{{request.params.*}}` 取值表——含标量、尺寸、时长、
// 以及档案驱动的参考输入（referenceInputParams）。**纯函数、依赖注入级别的纯**，故可零网络单测。
//
// 为什么单独成文件还配测试：duration 这种"数字被 firstString 吞成空串"的坑、omni 参考数组该不该进
// params 的坑，都只在"真实参数构建"里暴露，埋在 2500 行 runtime 里既测不到也容易回归。
import { firstString, type JsonRecord } from "../jsonUtils";
import { referenceInputParams } from "./archetypeInput";
import { ARCHETYPE_WIRE_DEFAULTS } from "./archetypeWireDefaults.generated";
import { bodyReferencedParamKeys } from "./paramTranslate";

/** taskTemplateParams 实际用到的 TaskRequest 子集（结构化，避免与 runtime 的 TaskRequest 循环依赖）。 */
export type TaskParamsInput = {
  extras?: Record<string, unknown>;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfgScale?: number;
  negativePrompt?: string;
};

export function firstReferenceImage(request: TaskParamsInput): string {
  const extras = request.extras || {};
  const referenceImages = Array.isArray(extras.referenceImages) ? extras.referenceImages : [];
  return firstString(
    extras.image_url,
    extras.imageUrl,
    extras.firstFrameUrl,
    extras.lastFrameUrl,
    referenceImages[0],
  );
}

/**
 * wire 必填参数兜底（headless/MCP 路）：UI 经 NodeGenerationComposer 按档案填好 size/voice/model 等；
 * 但 MCP/CLI 的 generate 不经 UI、也不暴露 params，缺必填参 vendor 直接拒（火山缺 size→400 / apimart 缺
 * model→500 / 豆包缺 voice→「未选择音色」）。把 mapping.create.defaultParams 合并到 extras **之下**
 * （既有值优先）：UI 路已填故零影响，headless 路得到一份能成的请求。纯函数（可单测）。
 */
export function applyWireDefaults(
  extras: Record<string, unknown> | undefined,
  defaultParams: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!defaultParams) return extras;
  return { ...defaultParams, ...(extras || {}) };
}

/**
 * headless/MCP 两道缺参兜底（既有值优先）：① 档案参数默认值（单一真相源，按 archetypeId+taskKind 桥接自
 * src/config，vendorParams 覆盖优先、回退通用 "*"；补 model 变体/duration(int)/比例/清晰度/voice/size）；
 * ② mapping 级 defaultParams（仅非档案派生的兜底）。逻辑收口在此 → runtime 一行调用，不喂巨壳。
 */
export function applyHeadlessParamDefaults(
  extras: Record<string, unknown> | undefined,
  archetypeId: string | undefined,
  taskKind: string,
  vendorKey: string,
  mappingDefaults: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const perKind = archetypeId ? ARCHETYPE_WIRE_DEFAULTS[archetypeId]?.[taskKind] : undefined;
  const archetypeDefaults = perKind ? (perKind[vendorKey] ?? perKind["*"]) : undefined;
  return applyWireDefaults(applyWireDefaults(extras, archetypeDefaults), mappingDefaults);
}

export function taskTemplateParams(request: TaskParamsInput): JsonRecord {
  const extras = request.extras || {};
  const size = request.width && request.height ? `${request.width}x${request.height}` : firstString(extras.size, extras.aspectRatio);
  // duration 可能是数字（节点「5s」标量参数存的就是 number 5）——firstString 只认字符串会把它吞成 ""，
  // 导致 body 的 duration 为空（实测）。数字原样保留，字符串走 trim，缺省 ""。
  const durationRaw = extras.duration ?? extras.durationSeconds ?? extras.videoDuration;
  const duration = typeof durationRaw === "number" ? durationRaw : firstString(durationRaw);
  const refInput = referenceInputParams(extras);
  const jsonEditInput = jsonImageEditInput(refInput.reference_images);
  return {
    ...extras,
    size,
    // n 强制数字（OpenAI images 要 int；UI number 参数可能存成字符串 "1"，整 token 会原样发 → 严格端点 400）。
    n: Number(extras.n) || 1,
    width: request.width,
    height: request.height,
    seed: request.seed,
    steps: request.steps,
    cfgScale: request.cfgScale,
    cfg_scale: request.cfgScale,
    negative_prompt: request.negativePrompt,
    duration,
    // 空→undefined（不是 ""）：body 的 `image: "{{request.params.image_url}}"` 整 token 渲染时，
    // undefined 会被丢弃、"" 却会当空字段发出去（纯文生图/文生视频误带 image:"" 会被部分中转拒）。
    image_url: firstReferenceImage(request) || undefined,
    // 参考输入（单图首/尾帧 + 多参考数组）—— 构建逻辑在 electron/catalog/archetypeInput（M5）。
    ...refInput,
    // chat/completions 多模态图生图（通用中转 gemini/nano-banana 系）：参考图 → content 里的 image_url 项数组。
    // 声明式模板展不开变长数组，故在此把 reference_images 建成 parts 数组；op body 用整 token 引用，
    // renderTemplateValue 会把它摊平进 content（见 requestPipeline flatMap）。空数组 → content 只剩 text 项。
    chat_image_parts: chatImageParts(refInput.reference_images),
    // JSON image-edits 协议（xAI Imagine 等）：单图必须是 image，多图必须是 images；模板层只负责
    // 丢 undefined，条件造型在这里一次完成。官方最多 3 张，超出的参考图不误发给严格端点。
    json_edit_image: jsonEditInput.image,
    json_edit_images: jsonEditInput.images,
    // xAI 单图编辑固定沿用输入图比例；只有多图编辑才允许显式 aspect_ratio。
    json_edit_aspect_ratio: jsonEditInput.images ? firstString(extras.aspect_ratio, extras.aspectRatio) || undefined : undefined,
    max_tokens: extras.maxTokens ?? extras.max_tokens,
  };
}

// 参考值的 URL 形状（http/nomi-local/data/blob/绝对路径）。护栏判定只认它——archetypeInput 里还混着
// model enum（如 "gpt-image-2-image-to-image"）和 fixedParams 常量，按「有任意值」判会误报有参考。
const REF_URL_RE = /^(https?:\/\/|nomi-local:\/\/|data:|blob:|\/)/i;

function containsRefUrl(value: unknown): boolean {
  if (typeof value === "string") return REF_URL_RE.test(value.trim());
  if (Array.isArray(value)) return value.some(containsRefUrl);
  if (value && typeof value === "object") return Object.values(value).some(containsRefUrl);
  return false;
}

/**
 * 图生图/图生视频请求里是否真的带了 ≥1 张参考素材（L3 诚实护栏，纯函数可测）。
 * 两路口径：① firstReferenceImage 单图聚合（image_url/firstFrameUrl/referenceImages[0]…）；
 * ② referenceInputParams 产出（档案 archetypeInput 的 input_urls/image_urls/volcengine content 项…
 *   或非档案的 reference_image_urls/reference_images），递归扫 URL 形状的值。
 * false = 用户意图「拿图改/拿图生」但一张图都递不出去 → 调用方拒发报人话，绝不静默退化纯文生。
 */
export function hasImageEditReferences(request: TaskParamsInput): boolean {
  if (firstReferenceImage(request)) return true;
  const extras = request.extras || {};
  // extras.image：headless/老调用方的裸键口径（部分 curated body 直读 {{request.params.image}}）。
  return containsRefUrl([extras.image, referenceInputParams(extras)]);
}

/** 本次请求真正携带的参考素材，按人话类别分组（只认 URL 形状的值）。 */
function carriedReferences(extras: JsonRecord): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  const push = (label: string, value: unknown): void => {
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      const url = typeof item === "string" ? item.trim() : "";
      if (url && REF_URL_RE.test(url)) out.push({ label, url });
    }
  };
  push("首帧", extras.firstFrameUrl);
  push("尾帧", extras.lastFrameUrl);
  push("角色参考图", extras.referenceImageUrls);
  push("参考视频", extras.referenceVideoUrls);
  push("参考音频", extras.referenceAudioUrls);
  return out;
}

/**
 * L3 诚实护栏第三闸（纯函数）：**这条 wire 的 body 到底读不读得到我要发的参考素材**。
 *
 * 为什么需要：UI 的能力由**模型档案**声明（供应商无关，同一模型走哪家都显示同一套槽位），而真正
 * 发出去的 body 由渠道模板决定。两者不匹配时——典型是「通用中转接入」用的是最小模板 {model,
 * prompt, duration, size, image}——用户连上的尾帧/角色图/参考视频/参考音频**在 body 里根本不出现**，
 * 于是静默退化成纯文生：生成成功、扣费成功、和参考素材毫无关系。
 *
 * 判据完全 derive，不 hardcode 任何 vendor 键名：把 body 引用到的 `{{request.params.X}}` 取出来，
 * 渲染出它们的值，看这次携带的每条参考 URL 在不在里面。在 = 发得出；不在 = 发不出。
 * 对所有渠道、所有模式成立。
 *
 * @returns 发不出去的参考类别（人话），空数组 = 全都发得出。
 */
export function unreachableReferenceLabels(request: TaskParamsInput, createBody: unknown): string[] {
  const carried = carriedReferences(request.extras || {});
  if (carried.length === 0) return [];
  const params = taskTemplateParams(request);
  const referencedKeys = bodyReferencedParamKeys(createBody);
  if (referencedKeys.length === 0) return [];
  const reachable = JSON.stringify(referencedKeys.map((key) => params[key]));
  const missing = new Set<string>();
  for (const ref of carried) if (!reachable.includes(ref.url)) missing.add(ref.label);
  return [...missing];
}

/**
 * L3 诚实护栏（runTask 前置闸，纯函数）：图生图/图生视频「参考图缺失」或「无传输 mapping」→ 返回
 * 人话错误（调用方在付费守卫/vendor 调用之前拒发，零扣费）；其余情况 null。此前会静默退化成纯文生
 * ——模板引擎丢空键 / fallback body 根本没有图片位——生成成功、扣费成功、和原图毫无关系，
 * 正是「图生图不按原图」的用户体感（docs/plan/2026-07-06-i2i-reference-reliability.md）。
 */
export function imageEditGuardError(
  kind: string,
  request: TaskParamsInput,
  hasMapping: boolean,
  modelLabel: string,
  /** 这条 mapping 的 create body。给了就多过一道闸：body 读不到的参考素材直接拒发（见上）。 */
  createBody?: unknown,
): string | null {
  // 第三闸对**所有 kind** 生效（运镜的参考视频可能挂在 t2v/omni 上），且只在真带了参考时才可能触发。
  if (typeof createBody !== "undefined") {
    const unreachable = unreachableReferenceLabels(request, createBody);
    if (unreachable.length > 0) {
      return `模型「${modelLabel}」在这个接入方式下发不出：${unreachable.join(" / ")}。连上的这些素材不会进入请求——为免白扣费这次不发。请断开它们，或换一个支持这些参考的渠道/模型。`;
    }
  }
  if (kind !== "image_edit" && kind !== "image_to_video") return null;
  const what = kind === "image_edit" ? "图生图" : "图生视频";
  if (!hasImageEditReferences(request)) {
    return `${what}缺少参考图：这次请求里没有任何图片可以发给模型。请连接一张图片节点（或在参考槽添加图片）后再生成${kind === "image_edit" ? "，或切回「文生图」" : ""}。`;
  }
  if (!hasMapping) {
    // 别再让用户「删除后重新接入一次」——中转视频模型缺这条通道的根因在接入路径本身（它从来不建
    // image_to_video），重接一万次也一样；已由 catalogCommit 补齐 + v8 迁移给存量自愈。走到这里说明
    // 这个上游/模型确实没有该能力，如实说，别给假动作。
    return `模型「${modelLabel}」没有「${kind === "image_edit" ? "图生图（改图）" : "图生视频"}」通道，参考图发不出去。请改用支持${what}的模型${kind === "image_edit" ? "，或断开参考图走纯文生图" : "，或断开参考图走纯文生视频"}。`;
  }
  return null;
}

/** 参考图 URL 数组 → chat/completions content 的 image_url 项数组。非字符串/空 URL 剔除。 */
export function chatImageParts(referenceImages: unknown): Array<{ type: "image_url"; image_url: { url: string } }> {
  if (!Array.isArray(referenceImages)) return [];
  return referenceImages
    .filter((u): u is string => typeof u === "string" && u.trim() !== "")
    .map((url) => ({ type: "image_url", image_url: { url } }));
}

export type JsonImageEditReference = { type: "image_url"; url: string };

/** JSON image-edits 输入造型：1 张走 image，2~3 张走 images；保序、去空、按官方上限截断。 */
export function jsonImageEditInput(referenceImages: unknown): { image?: JsonImageEditReference; images?: JsonImageEditReference[] } {
  if (!Array.isArray(referenceImages)) return {};
  const refs = referenceImages
    .filter((url): url is string => typeof url === "string" && url.trim() !== "")
    .slice(0, 3)
    .map((url) => ({ type: "image_url" as const, url }));
  if (refs.length === 1) return { image: refs[0] };
  return refs.length > 1 ? { images: refs } : {};
}

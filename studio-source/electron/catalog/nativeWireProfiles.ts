import { VOLCENGINE_SEEDANCE_QUERY_OP, VOLCENGINE_SEEDANCE_STATUS_MAPPING, VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";
import type { HttpOperation, ProfileKind } from "./types";

// ---------------------------------------------------------------------------
// 「认得出的模型走它的原生报文」注册表（通用中转接入用）。
//
// 为什么需要：Nomi 的 UI 参数由**模型档案**驱动，档案只认模型身份、与从哪家接入无关（同一模型
// 不管走哪个渠道，用户看到的应是同一套能力）。但真正发出去的报文由渠道模板决定——「用户自建
// 中转」走的是通用最小模板 {model, prompt, duration, size, image}。于是界面给一整套（变体/比例/
// 生成音频/首尾帧/角色图/参考视频/参考音频），线上只发得出一小截，连了边的参考素材被静默丢。
//
// 而 new-api 这类中转普遍**同时**代理厂商原生端点（用户那家的 §6.2 明确推荐 /api/v3/…）。
// 所以：接入时若模型命中内置档案，就探一下这家有没有该档案的原生端点，有就直接复用**已验证的
// 那份原生报文**（只换地址）。通用做法，不是给某一家打补丁（P4）。
//
// 单一真相源：op 一律**引用**各 vendor 模块里已有的常量，绝不在这里复制形状（P1）。
// ---------------------------------------------------------------------------

export type NativeWireProfile = {
  /** 命中哪个档案（src/config/modelArchetypes 的 archetype.id）。 */
  archetypeId: string;
  /** 拼进 mapping.name 的渠道名（与内置种子的中文 name 同性质，非 UI 文案）。 */
  wireName: string;
  /**
   * 探测用的**真实端点路径**（会被 nativeEndpointProbe 拿去和「查无此路由」的哨兵响应比对）。
   * 用 GET 探（不产生任务、不计费）。
   */
  probePath: string;
  /** 按 taskKind 的 create op。 */
  create: Partial<Record<ProfileKind, HttpOperation>>;
  /** 轮询 op（异步任务）。 */
  query?: HttpOperation;
  statusMapping?: Record<string, string[]>;
};

/** 火山方舟原生（Seedance 2.0）。中转代理方舟时可直接用这套：首/尾帧、角色图×9、参考视频×3、
 *  参考音频×3、generate_audio、ratio、resolution 全在，与用户那家中转文档 §6.2 逐字对得上。 */
function volcengineSeedanceProfile(): NativeWireProfile {
  const model = VOLCENGINE_VIDEO_MODELS.find((m) => m.archetypeId === "volcengine-seedance-2");
  const create: Partial<Record<ProfileKind, HttpOperation>> = {};
  for (const mapping of model?.mappings ?? []) {
    // 原生端点不在 /v1 命名空间下；中转用户常把地址填成 .../v1 → 必须从主机根拼。
    create[mapping.taskKind] = { ...mapping.create, pathFrom: "host-root" };
  }
  return {
    archetypeId: "volcengine-seedance-2",
    wireName: "火山方舟原生",
    probePath: "/api/v3/contents/generations/tasks",
    create,
    query: { ...VOLCENGINE_SEEDANCE_QUERY_OP, pathFrom: "host-root" },
    statusMapping: VOLCENGINE_SEEDANCE_STATUS_MAPPING,
  };
}

const PROFILES: NativeWireProfile[] = [volcengineSeedanceProfile()];

/** 按档案 id 查原生 wire 配方；没有就返回 null（该模型没有可复用的原生形状）。 */
export function nativeWireProfileForArchetype(archetypeId: string | null | undefined): NativeWireProfile | null {
  const id = String(archetypeId || "").trim();
  if (!id) return null;
  return PROFILES.find((p) => p.archetypeId === id) ?? null;
}

/** 全部配方（探测/自愈遍历用）。 */
export function listNativeWireProfiles(): NativeWireProfile[] {
  return PROFILES;
}

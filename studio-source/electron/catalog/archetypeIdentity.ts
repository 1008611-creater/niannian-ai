import { ARCHETYPE_IDENTIFIER_PATTERNS } from "./archetypeIdentifiers.generated";

// 主进程侧的「modelKey → 档案 id」识别。
//
// 为什么在这里也要有：档案住 src/config（渲染层），electron 的 rootDir 隔离 import 不到；但主进程
// 要能认出「这个模型是不是某个内置档案」——中转接入时据此决定有没有可复用的原生报文、启动自愈时同理。
// 身份表由 scripts/gen-archetype-wire-defaults.ts 从档案生成（单一真相源，check:archetype-defaults 防漂移）；
// **匹配规则逐字对齐** src/config/modelArchetypes/index.ts 的 identifierMatchesPattern，改一处必改两处。

/** 与渲染层 normalizeIdentifier 同规则：trim + 去 "models/" 前缀 + 小写。 */
function normalizeIdentifier(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const noPrefix = raw.startsWith("models/") ? raw.slice("models/".length) : raw;
  return noPrefix.toLowerCase();
}

/** 取标识末段（去 vendor 前缀，"bytedance/seedance-2" → "seedance-2"）。 */
function lastSegment(identifier: string): string {
  const idx = identifier.lastIndexOf("/");
  return idx >= 0 ? identifier.slice(idx + 1) : identifier;
}

function identifierMatchesPattern(identifier: string, pattern: string): boolean {
  const id = normalizeIdentifier(identifier);
  const pat = normalizeIdentifier(pattern);
  if (!id || !pat) return false;
  // 整串相等，或去掉 vendor 前缀后的末段相等 —— 故 seedance-2 不会误命中 seedance-2-fast。
  return id === pat || lastSegment(id) === lastSegment(pat);
}

/** 从 modelKey / modelAlias 认出档案 id；认不出返回 null。与渲染层解析结果一致（都与 vendor 无关）。 */
export function archetypeIdForModel(modelKey?: string | null, modelAlias?: string | null): string | null {
  const identities = [modelKey, modelAlias].filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (identities.length === 0) return null;
  for (const [archetypeId, patterns] of Object.entries(ARCHETYPE_IDENTIFIER_PATTERNS)) {
    for (const pattern of patterns) {
      if (identities.some((identity) => identifierMatchesPattern(identity, pattern))) return archetypeId;
    }
  }
  return null;
}

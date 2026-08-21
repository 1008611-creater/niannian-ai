// 主进程侧「modelKey → 档案 id」：身份表由档案生成，匹配规则与渲染层 identifierMatchesPattern 同源。
import { describe, expect, it } from "vitest";
import { archetypeIdForModel } from "./archetypeIdentity";
import { nativeWireProfileForArchetype } from "./nativeWireProfiles";
import { hostRootBase } from "../ai/requestPipeline";

describe("archetypeIdForModel", () => {
  it("认出用户那三个 Seedance 2.0 变体，全都落火山档案", () => {
    expect(archetypeIdForModel("doubao-seedance-2-0-260128")).toBe("volcengine-seedance-2");
    expect(archetypeIdForModel("doubao-seedance-2-0-fast-260128")).toBe("volcengine-seedance-2");
    expect(archetypeIdForModel("doubao-seedance-2-0-mini-260615")).toBe("volcengine-seedance-2");
  });

  it("去掉 vendor 前缀后按末段匹配（与渲染层同规则）", () => {
    expect(archetypeIdForModel("bytedance/seedance-2")).toBe("seedance-2");
    expect(archetypeIdForModel("models/seedance-2")).toBe("seedance-2");
  });

  it("认不出的返回 null（不瞎猜）", () => {
    expect(archetypeIdForModel("some-unknown-model-xyz")).toBeNull();
    expect(archetypeIdForModel("")).toBeNull();
    expect(archetypeIdForModel(null)).toBeNull();
  });
});

describe("nativeWireProfileForArchetype", () => {
  it("火山 Seedance 档案有原生报文配方，且 t2v/i2v/query 都从主机根拼", () => {
    const p = nativeWireProfileForArchetype("volcengine-seedance-2");
    expect(p?.probePath).toBe("/api/v3/contents/generations/tasks");
    expect(p?.create.text_to_video?.pathFrom).toBe("host-root");
    expect(p?.create.image_to_video?.pathFrom).toBe("host-root");
    expect(p?.query?.pathFrom).toBe("host-root");
    // 原生 i2v body 必须真的读得到五类参考（这才是走它的理由）。
    const body = JSON.stringify(p?.create.image_to_video?.body);
    for (const key of [
      "volcengine_first_role_image_content",
      "volcengine_last_role_image_content",
      "volcengine_image_contents",
      "volcengine_video_contents",
      "volcengine_audio_contents",
    ]) {
      expect(body).toContain(key);
    }
  });

  it("没有原生配方的档案返回 null", () => {
    expect(nativeWireProfileForArchetype("seedance-2")).toBeNull();
    expect(nativeWireProfileForArchetype(undefined)).toBeNull();
  });
});

describe("hostRootBase", () => {
  it("剥掉结尾的版本段，好让 /api/v3 从主机根拼（用户地址填了 /v1）", () => {
    expect(hostRootBase("https://sd.example.com:8443/v1")).toBe("https://sd.example.com:8443");
    expect(hostRootBase("https://sd.example.com:8443/v1/")).toBe("https://sd.example.com:8443");
    expect(hostRootBase("https://sd.example.com:8443")).toBe("https://sd.example.com:8443");
    // 只剥结尾一层：/codex/v1 → /codex（中间段是人家的路由前缀，不能动）
    expect(hostRootBase("https://code.example.com/codex/v1")).toBe("https://code.example.com/codex");
  });
});

// v7 → v8：给存量「中转接入的视频模型」补图生视频通道（image_to_video mapping）。
//
// 真机(2026-07-30)抓到的真 bug：用户接了个只有 Seedance 视频模型的 new-api 中转，视频节点连上首帧图
// 就报「模型…在本机没有配置『图生视频』通道…请删除该模型后重新接入一次」。而重新接入**也不会**建
// 这条通道——newapiTransportFor("video") 从来只返回 text_to_video。接入路径已同 commit 修好；这条
// 迁移负责让**已经接进去的存量模型**直接可用，不必删了重加。
import { describe, expect, it } from "vitest";
import { migrateRelayVideoImageToVideo } from "./catalogStore";
import { NEWAPI_VIDEO_CREATE_OP, NEWAPI_VIDEO_QUERY_OP } from "./newapiTransport";
import type { CatalogState, Mapping, Model, Vendor } from "./types";

const NOW = "2026-07-30T00:00:00.000Z";

const vendor = (key: string): Vendor => ({
  key, name: key, enabled: true, hasApiKey: true,
  baseUrlHint: "https://relay.example.com/v1", authType: "bearer", authHeader: null,
  authQueryParam: null, providerKind: "openai-compatible", createdAt: NOW, updatedAt: NOW,
});

const videoModel = (modelKey: string, vendorKey = "seedance-relay"): Model => ({
  modelKey, vendorKey, modelAlias: modelKey, labelZh: modelKey,
  kind: "video", enabled: true, createdAt: NOW, updatedAt: NOW,
});

const t2vMapping = (vendorKey = "seedance-relay"): Mapping => ({
  id: `mapping-t2v-${vendorKey}`, vendorKey, taskKind: "text_to_video", name: "文生视频",
  enabled: true, create: NEWAPI_VIDEO_CREATE_OP, query: NEWAPI_VIDEO_QUERY_OP,
  createdAt: NOW, updatedAt: NOW,
});

const state = (over: Partial<CatalogState> = {}): CatalogState => ({
  version: 7,
  vendors: [vendor("seedance-relay")],
  models: [videoModel("doubao-seedance-2-0-260128"), videoModel("doubao-seedance-2-0-fast-260128")],
  mappings: [t2vMapping()],
  apiKeysByVendor: {},
  ...over,
});

describe("migrateRelayVideoImageToVideo（v7→v8）", () => {
  it("给每个存量中转视频模型补一条 modelKey 精确的 image_to_video（带轮询 query）", () => {
    const migrated = migrateRelayVideoImageToVideo(state());
    expect(migrated.changed).toBe(true);
    const i2v = migrated.state.mappings.filter((m) => m.taskKind === "image_to_video");
    expect(i2v.map((m) => m.modelKey).sort()).toEqual([
      "doubao-seedance-2-0-260128",
      "doubao-seedance-2-0-fast-260128",
    ]);
    // wire 与文生视频同一条（new-api 视频端点自带可选 image 首帧），且视频是异步任务必须带轮询。
    expect(i2v[0].create).toBe(NEWAPI_VIDEO_CREATE_OP);
    expect(i2v[0].query).toBe(NEWAPI_VIDEO_QUERY_OP);
    expect(i2v[0].enabled).toBe(true);
  });

  it("幂等：重跑不再新增", () => {
    const first = migrateRelayVideoImageToVideo(state());
    const second = migrateRelayVideoImageToVideo(first.state);
    expect(second.changed).toBe(false);
    expect(second.state.mappings.filter((m) => m.taskKind === "image_to_video")).toHaveLength(2);
  });

  it("已有 vendor 级通用 image_to_video 时不重复补", () => {
    const generic: Mapping = {
      id: "mapping-i2v-generic", vendorKey: "seedance-relay", taskKind: "image_to_video",
      name: "图生视频", enabled: true, create: NEWAPI_VIDEO_CREATE_OP, createdAt: NOW, updatedAt: NOW,
    };
    const migrated = migrateRelayVideoImageToVideo(state({ mappings: [t2vMapping(), generic] }));
    expect(migrated.changed).toBe(false);
  });

  it("不碰内置 vendor（kie/apimart 等由 seedBuiltins 自己管协议）", () => {
    const migrated = migrateRelayVideoImageToVideo(state({
      vendors: [vendor("apimart")],
      models: [videoModel("seedance-2-apimart", "apimart")],
      mappings: [t2vMapping("apimart")],
    }));
    expect(migrated.changed).toBe(false);
  });

  it("没有 /video/generations 形状证据的中转不碰（不给不相干形状乱套模板）", () => {
    const odd: Mapping = { ...t2vMapping(), create: { method: "POST", path: "/custom/render", body: {} } };
    const migrated = migrateRelayVideoImageToVideo(state({ mappings: [odd] }));
    expect(migrated.changed).toBe(false);
  });

  it("非视频模型不碰", () => {
    const migrated = migrateRelayVideoImageToVideo(state({
      models: [{ ...videoModel("some-image-model"), kind: "image" }],
    }));
    expect(migrated.changed).toBe(false);
  });
});

// derive 式路由探测：先学这家网关「查无此路由」长什么样，再比对目标。
// 回归重点是 SPA 陷阱：new-api/one-api 的后台对**顶层**未知路径回 200 + index.html，
// 拿顶层假路径当哨兵就会学到错签名 → 什么都判成「端点存在」（实测踩过）。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeNativeEndpoint } from "./nativeEndpointProbe";

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || "").split("?")[0];
    // 真路由（走到鉴权层就 401）
    if (url.startsWith("/api/v3/contents/generations/tasks")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid token (request id: abc123)", type: "new_api_error" } }));
      return;
    }
    if (url.startsWith("/v1/video/generations")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid token (request id: def456)", type: "new_api_error" } }));
      return;
    }
    // API 命名空间下的未知路由 → 404 + 回显路径（每次回显不同，签名归一化必须抹掉它）
    if (url.startsWith("/api/") || url.startsWith("/v1/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Invalid URL (GET ${url})`, type: "invalid_request_error" } }));
      return;
    }
    // 顶层未知路径 → 后台 SPA 首页 200（就是那个陷阱）
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><html><head><title>Dashboard</title></head><body></body></html>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("probeNativeEndpoint", () => {
  it("认出真实存在的原生端点", async () => {
    const r = await probeNativeEndpoint(base, "/api/v3/contents/generations/tasks");
    expect(r.exists).toBe(true);
  });

  it("对不存在的端点如实说不存在（哨兵取同级兄弟，不被顶层 SPA 200 骗到）", async () => {
    const r = await probeNativeEndpoint(base, "/api/v9/totally/made/up");
    expect(r.exists).toBe(false);
  });

  it("地址带 /v1 也能剥到主机根去探原生路径（用户就是这么填的）", async () => {
    const r = await probeNativeEndpoint(`${base}/v1`, "/api/v3/contents/generations/tasks");
    expect(r.exists).toBe(true);
  });

  it("同一台机器上的 OpenAI 兼容端点同样判存在", async () => {
    const r = await probeNativeEndpoint(base, "/v1/video/generations");
    expect(r.exists).toBe(true);
  });

  it("地址不是 http(s) → 不探，判不支持", async () => {
    const r = await probeNativeEndpoint("not-a-url", "/api/v3/contents/generations/tasks");
    expect(r.exists).toBe(false);
  });

  it("连不上的地址 → 如实按不支持处理，不抛", async () => {
    const r = await probeNativeEndpoint("http://127.0.0.1:9", "/api/v3/contents/generations/tasks");
    expect(r.exists).toBe(false);
  });
});

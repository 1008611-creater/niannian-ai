import { isPrivateHost } from "./hardenedFetch";

/**
 * Provider endpoints may use HTTP only for explicitly local services.
 * Public endpoints must use HTTPS before credentials are sent.
 */
export function validateCredentialEndpoint(rawUrl: string): string {
  const value = String(rawUrl || "").trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("接入地址必须是有效的 http(s) 地址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("接入地址必须使用 http:// 或 https://");
  }
  if (url.protocol === "http:" && !isPrivateHost(url.hostname)) {
    throw new Error("公网接入地址必须使用 HTTPS；HTTP 仅允许本机或内网服务");
  }
  return url.toString().replace(/\/+$/, "");
}

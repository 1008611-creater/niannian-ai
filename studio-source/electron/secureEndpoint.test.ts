import { describe, expect, it } from "vitest";
import { validateCredentialEndpoint } from "./secureEndpoint";

describe("validateCredentialEndpoint", () => {
  it("allows HTTPS provider endpoints", () => {
    expect(validateCredentialEndpoint("https://api.example.com/v1/"))
      .toBe("https://api.example.com/v1");
  });

  it("allows HTTP only for local services", () => {
    expect(validateCredentialEndpoint("http://127.0.0.1:11434/v1/"))
      .toBe("http://127.0.0.1:11434/v1");
    expect(validateCredentialEndpoint("http://localhost:8188"))
      .toBe("http://localhost:8188");
  });

  it("rejects public HTTP endpoints", () => {
    expect(() => validateCredentialEndpoint("http://api.example.com/v1"))
      .toThrow("公网接入地址必须使用 HTTPS");
  });

  it("rejects non-http protocols", () => {
    expect(() => validateCredentialEndpoint("ftp://api.example.com/model"))
      .toThrow("必须使用 http:// 或 https://");
  });
});

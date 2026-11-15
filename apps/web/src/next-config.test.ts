import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config.js";
import { proxy } from "./proxy.js";

describe("web response security headers", () => {
  it("sets browser protections and enables HSTS only when HTTPS is guaranteed", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    process.env.VERCEL = "1";
    const config = await nextConfig("phase-production-server");
    const rules = await config.headers?.();
    const headers = new Map(rules?.[0]?.headers.map(({ key, value }) => [key, value]));
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=31536000");

    const response = proxy(new NextRequest("https://example.test/"));
    const policy = response.headers.get("Content-Security-Policy");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeDefined();
    expect(response.headers.get("Content-Security-Policy")).toBe(policy);

    delete process.env.VERCEL;
    const development = await nextConfig("phase-development-server");
    const devRules = await development.headers?.();
    expect(devRules?.[0]?.headers.some(({ key }) => key === "Strict-Transport-Security")).toBe(
      false,
    );
  });

  it("lets the browser read a loopback local chain only when one is configured", () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001";
    delete process.env.NEXT_PUBLIC_LOCAL_CHAIN_RPC_URL;
    const connectSrc = (): string =>
      proxy(new NextRequest("https://example.test/"))
        .headers.get("Content-Security-Policy")
        ?.split("; ")
        .find((directive) => directive.startsWith("connect-src")) ?? "";
    expect(connectSrc()).not.toContain("8545");

    process.env.NEXT_PUBLIC_LOCAL_CHAIN_RPC_URL = "http://127.0.0.1:8545";
    expect(connectSrc()).toContain("http://127.0.0.1:8545");

    process.env.NEXT_PUBLIC_LOCAL_CHAIN_RPC_URL = "http://evil.example:8545";
    expect(connectSrc()).not.toContain("evil.example");
    delete process.env.NEXT_PUBLIC_LOCAL_CHAIN_RPC_URL;
  });
});

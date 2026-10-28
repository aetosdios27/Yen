import { describe, expect, it } from "vitest";
import {
  CACHE_NAME,
  CACHE_VERSION,
  cleanOldCaches,
  isNavigationRequest,
  OFFLINE_URL,
  PRECACHE_URLS,
  shouldCache,
} from "./cache-rules";

describe("service worker cache naming and precache", () => {
  it("defines cache version and expected name pattern", () => {
    expect(CACHE_VERSION).toBe("v1");
    expect(CACHE_NAME).toBe(`yen-shell-${CACHE_VERSION}`);
  });

  it("precaches offline fallback, manifest, and icons", () => {
    expect(OFFLINE_URL).toBe("/offline");
    expect(PRECACHE_URLS).toContain(OFFLINE_URL);
    expect(PRECACHE_URLS).toContain("/manifest.webmanifest");
    expect(PRECACHE_URLS).toContain("/icons/icon-192.png");
    expect(PRECACHE_URLS).toContain("/icons/icon-512.png");
    expect(PRECACHE_URLS).toContain("/icons/icon-maskable-512.png");
    expect(PRECACHE_URLS).toContain("/icons/apple-touch-icon.png");
  });
});

describe("navigation request detection", () => {
  it("detects navigation requests by mode or destination", () => {
    expect(isNavigationRequest({ url: "http://localhost:3000/", mode: "navigate" })).toBe(true);
    expect(
      isNavigationRequest({ url: "http://localhost:3000/offline", destination: "document" }),
    ).toBe(true);
  });

  it("detects GET requests with text/html accept header", () => {
    expect(
      isNavigationRequest({
        url: "http://localhost:3000/design-system",
        method: "GET",
        headers: { accept: "text/html,application/xhtml+xml" },
      }),
    ).toBe(true);
  });

  it("rejects non-navigation requests", () => {
    expect(
      isNavigationRequest({
        url: "http://localhost:3000/_next/static/chunks/app.js",
        method: "GET",
        headers: { accept: "*/*" },
      }),
    ).toBe(false);
    expect(
      isNavigationRequest({
        url: "http://localhost:3000/v1/waitlist",
        method: "POST",
        headers: { accept: "application/json" },
      }),
    ).toBe(false);
  });
});

describe("shouldCache rule enforcement", () => {
  const origin = "http://localhost:3000";

  describe("NEVER cases", () => {
    it("NEVER caches anything under /v1/", () => {
      expect(shouldCache({ url: `${origin}/v1`, method: "GET" }, undefined, origin)).toBe(false);
      expect(shouldCache({ url: `${origin}/v1/waitlist`, method: "GET" }, undefined, origin)).toBe(
        false,
      );
      expect(
        shouldCache({ url: `${origin}/v1/records/100`, method: "GET" }, undefined, origin),
      ).toBe(false);
      expect(
        shouldCache(
          { url: `${origin}/v1/auth/session`, method: "GET" },
          { status: 200, headers: { "content-type": "application/json" } },
          origin,
        ),
      ).toBe(false);
    });

    it("NEVER caches non-GET requests", () => {
      const staticUrl = `${origin}/_next/static/chunks/main.js`;
      expect(shouldCache({ url: staticUrl, method: "POST" }, undefined, origin)).toBe(false);
      expect(shouldCache({ url: staticUrl, method: "PUT" }, undefined, origin)).toBe(false);
      expect(shouldCache({ url: staticUrl, method: "DELETE" }, undefined, origin)).toBe(false);
      expect(shouldCache({ url: staticUrl, method: "PATCH" }, undefined, origin)).toBe(false);
      expect(shouldCache({ url: staticUrl, method: "HEAD" }, undefined, origin)).toBe(false);
    });

    it("NEVER caches cross-origin requests", () => {
      expect(
        shouldCache(
          { url: "https://external-cdn.com/_next/static/chunk.js", method: "GET" },
          undefined,
          origin,
        ),
      ).toBe(false);
      expect(
        shouldCache({ url: "https://api.yen.in/v1/records", method: "GET" }, undefined, origin),
      ).toBe(false);
    });

    it("NEVER caches responses with Cache-Control: no-store", () => {
      const req = { url: `${origin}/_next/static/chunks/main.js`, method: "GET" };
      expect(
        shouldCache(req, { status: 200, headers: { "cache-control": "no-store" } }, origin),
      ).toBe(false);
      expect(
        shouldCache(
          req,
          { status: 200, headers: { "cache-control": "no-cache, no-store, must-revalidate" } },
          origin,
        ),
      ).toBe(false);
    });

    it("NEVER caches responses with Cache-Control: private", () => {
      const req = { url: `${origin}/_next/static/chunks/main.js`, method: "GET" };
      expect(
        shouldCache(req, { status: 200, headers: { "cache-control": "private" } }, origin),
      ).toBe(false);
      expect(
        shouldCache(
          req,
          { status: 200, headers: { "cache-control": "private, max-age=3600" } },
          origin,
        ),
      ).toBe(false);
    });

    it("NEVER caches HTML documents other than the offline fallback", () => {
      // Navigation / document mode requests are rejected
      expect(
        shouldCache(
          { url: `${origin}/design-system`, method: "GET", mode: "navigate" },
          undefined,
          origin,
        ),
      ).toBe(false);
      expect(
        shouldCache(
          { url: `${origin}/`, method: "GET", destination: "document" },
          undefined,
          origin,
        ),
      ).toBe(false);
      // text/html accept header rejected
      expect(
        shouldCache(
          { url: `${origin}/fund`, method: "GET", headers: { accept: "text/html" } },
          undefined,
          origin,
        ),
      ).toBe(false);
      // text/html response rejected even if static URL was faked
      expect(
        shouldCache(
          { url: `${origin}/_next/static/page`, method: "GET" },
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          origin,
        ),
      ).toBe(false);
    });

    it("NEVER caches non-200 responses", () => {
      const req = { url: `${origin}/_next/static/chunks/main.js`, method: "GET" };
      expect(shouldCache(req, { status: 404 }, origin)).toBe(false);
      expect(shouldCache(req, { status: 500 }, origin)).toBe(false);
      expect(shouldCache(req, { status: 304 }, origin)).toBe(false);
    });

    it("NEVER caches opaque responses", () => {
      const req = { url: `${origin}/_next/static/chunks/main.js`, method: "GET" };
      expect(shouldCache(req, { status: 200, type: "opaque" }, origin)).toBe(false);
    });
  });

  describe("ALLOWED cases", () => {
    it("caches same-origin GET static build assets", () => {
      expect(
        shouldCache(
          { url: `${origin}/_next/static/chunks/app.js`, method: "GET" },
          undefined,
          origin,
        ),
      ).toBe(true);
      expect(
        shouldCache(
          { url: `${origin}/_next/static/css/global.css`, method: "GET" },
          undefined,
          origin,
        ),
      ).toBe(true);
    });

    it("caches icons and favicon", () => {
      expect(
        shouldCache({ url: `${origin}/icons/icon-192.png`, method: "GET" }, undefined, origin),
      ).toBe(true);
      expect(
        shouldCache({ url: `${origin}/icons/icon-512.png`, method: "GET" }, undefined, origin),
      ).toBe(true);
      expect(shouldCache({ url: `${origin}/favicon.ico`, method: "GET" }, undefined, origin)).toBe(
        true,
      );
      expect(
        shouldCache({ url: `${origin}/apple-touch-icon.png`, method: "GET" }, undefined, origin),
      ).toBe(true);
    });

    it("caches fonts by extension or font destination", () => {
      expect(
        shouldCache({ url: `${origin}/fonts/noto-sans.woff2`, method: "GET" }, undefined, origin),
      ).toBe(true);
      expect(
        shouldCache(
          { url: `${origin}/custom-font-asset`, method: "GET", destination: "font" },
          undefined,
          origin,
        ),
      ).toBe(true);
    });

    it("caches valid 200 static response with public cache-control", () => {
      const req = { url: `${origin}/_next/static/chunks/123.js`, method: "GET" };
      const res = {
        status: 200,
        headers: {
          "content-type": "application/javascript",
          "cache-control": "public, max-age=31536000, immutable",
        },
      };
      expect(shouldCache(req, res, origin)).toBe(true);
    });
  });
});

describe("cleanOldCaches cache-version bump", () => {
  it("deletes old yen caches while preserving the current cache and unrelated caches", async () => {
    const store = new Map<string, boolean>([
      ["yen-shell-v0", true],
      ["yen-shell-v1", true],
      ["other-app-cache", true],
    ]);

    const fakeCacheStorage = {
      keys: async () => Array.from(store.keys()),
      delete: async (key: string) => {
        store.delete(key);
        return true;
      },
    };

    const currentCacheName = "yen-shell-v1";
    const deleted = await cleanOldCaches(fakeCacheStorage, currentCacheName);

    expect(deleted).toEqual(["yen-shell-v0"]);
    expect(store.has("yen-shell-v0")).toBe(false);
    expect(store.has("yen-shell-v1")).toBe(true);
    expect(store.has("other-app-cache")).toBe(true);
  });

  it("deletes previous version when cache bumps to v2", async () => {
    const store = new Map<string, boolean>([
      ["yen-shell-v1", true],
      ["yen-shell-v2", true],
    ]);

    const fakeCacheStorage = {
      keys: async () => Array.from(store.keys()),
      delete: async (key: string) => {
        store.delete(key);
        return true;
      },
    };

    const deleted = await cleanOldCaches(fakeCacheStorage, "yen-shell-v2");

    expect(deleted).toEqual(["yen-shell-v1"]);
    expect(store.has("yen-shell-v1")).toBe(false);
    expect(store.has("yen-shell-v2")).toBe(true);
  });
});

// A classic script, not an ES module: service workers registered without `type: "module"` (older
// Android WebViews, Firefox) cannot run `import`, so sw.js loads this with importScripts and reads
// the rules from a global. Everything sits inside a function because importScripts shares the
// worker's top-level scope: bare top-level `const` names here would clash with sw.js. Tests load the
// same file for its side effect and read the same global.
((root) => {
  const CACHE_VERSION = "v1";
  const CACHE_NAME = `yen-shell-${CACHE_VERSION}`;
  const OFFLINE_URL = "/offline";

  const PRECACHE_URLS = [
    OFFLINE_URL,
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/favicon.ico",
  ];

  function getHeader(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === "function") {
      return headers.get(name);
    }
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === target) {
        return value;
      }
    }
    return null;
  }

  function isNavigationRequest(request) {
    if (!request) return false;
    if (request.mode === "navigate") return true;
    if (request.destination === "document") return true;
    const method = (request.method || "GET").toUpperCase();
    if (method === "GET") {
      const accept = getHeader(request.headers, "accept") || "";
      if (accept.includes("text/html")) {
        return true;
      }
    }
    return false;
  }

  function shouldCache(request, response, baseOrigin) {
    if (!request) return false;

    const method = (request.method || "GET").toUpperCase();
    if (method !== "GET") {
      return false;
    }

    const origin =
      baseOrigin ||
      (typeof self !== "undefined" && self.location && self.location.origin
        ? self.location.origin
        : "http://localhost:3000");

    let parsedUrl;
    try {
      parsedUrl = new URL(request.url, origin);
    } catch {
      return false;
    }

    if (parsedUrl.origin !== origin) {
      return false;
    }

    if (parsedUrl.pathname === "/v1" || parsedUrl.pathname.startsWith("/v1/")) {
      return false;
    }

    if (request.mode === "navigate" || request.destination === "document") {
      return false;
    }

    const accept = getHeader(request.headers, "accept") || "";
    if (accept.includes("text/html")) {
      return false;
    }

    const isNextStatic = parsedUrl.pathname.startsWith("/_next/static/");
    const isIcon =
      parsedUrl.pathname.startsWith("/icons/") ||
      parsedUrl.pathname === "/favicon.ico" ||
      parsedUrl.pathname === "/apple-touch-icon.png";
    const isFont =
      request.destination === "font" || /\.(?:woff2?|ttf|otf|eot)$/i.test(parsedUrl.pathname);

    if (!isNextStatic && !isIcon && !isFont) {
      return false;
    }

    if (response) {
      if (response.status !== undefined && response.status !== 200) {
        return false;
      }
      if (response.type === "opaque") {
        return false;
      }
      const contentType = getHeader(response.headers, "content-type") || "";
      if (contentType.includes("text/html")) {
        return false;
      }
      const cacheControl = getHeader(response.headers, "cache-control") || "";
      if (/\b(?:no-store|private)\b/i.test(cacheControl)) {
        return false;
      }
    }

    return true;
  }

  async function cleanOldCaches(cacheStorage, currentCacheName = CACHE_NAME) {
    if (!cacheStorage || typeof cacheStorage.keys !== "function") {
      return [];
    }
    const keys = await cacheStorage.keys();
    const deleted = [];
    for (const key of keys) {
      if (key !== currentCacheName && key.startsWith("yen-")) {
        await cacheStorage.delete(key);
        deleted.push(key);
      }
    }
    return deleted;
  }

  root.YenSwRules = {
    CACHE_VERSION,
    CACHE_NAME,
    OFFLINE_URL,
    PRECACHE_URLS,
    isNavigationRequest,
    shouldCache,
    cleanOldCaches,
  };
})(typeof self !== "undefined" ? self : globalThis);

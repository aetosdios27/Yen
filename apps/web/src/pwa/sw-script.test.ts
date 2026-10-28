import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const publicDir = join(__dirname, "../../public");
const read = (name: string) => readFileSync(join(publicDir, name), "utf8");

// A service worker registered without `type: "module"` runs as a classic script: no import/export,
// and importScripts shares one top-level scope with the worker. Older Android WebViews and Firefox
// only run workers that way, so these tests load the real files the way a classic worker does.
function loadWorker() {
  const listeners: Record<string, unknown> = {};
  const scope: Record<string, unknown> = {
    addEventListener: (type: string, listener: unknown) => {
      listeners[type] = listener;
    },
    caches: {},
    location: { origin: "http://localhost:3000" },
  };
  scope.self = scope;
  const context = vm.createContext(scope);
  scope.importScripts = (url: string) => {
    vm.runInContext(read(url.replace(/^\//, "")), context, { filename: url });
  };
  vm.runInContext(read("sw.js"), context, { filename: "/sw.js" });
  return { scope, listeners };
}

describe("service worker script", () => {
  it("evaluates as a classic script with its rules loaded by importScripts", () => {
    const { listeners } = loadWorker();
    expect(Object.keys(listeners).sort()).toEqual(["activate", "fetch", "install"]);
  });

  it("contains no ES module syntax", () => {
    expect(read("sw.js")).not.toMatch(/^\s*(import|export)\b/m);
    expect(read("sw-rules.js")).not.toMatch(/^\s*(import|export)\b/m);
  });

  it("publishes the rules on a global without leaking top-level names", () => {
    const { scope } = loadWorker();
    const rules = scope.YenSwRules as { shouldCache: unknown; CACHE_NAME: string };
    expect(typeof rules.shouldCache).toBe("function");
    expect(rules.CACHE_NAME).toMatch(/^yen-/);
  });

  it("keeps the worker alive for the cache write and survives a failed write", async () => {
    const { scope, listeners } = loadWorker();
    let resolvePut!: () => void;
    const putCalls: Array<Promise<void>> = [];
    const cache = {
      match: async () => undefined,
      put: () => {
        const write = new Promise<void>((resolve, reject) => {
          resolvePut = resolve;
          setTimeout(() => reject(new Error("quota")), 0);
        });
        putCalls.push(write);
        return write;
      },
    };
    // A bare vm context has no web platform globals; a real worker does.
    scope.URL = URL;
    scope.caches = { open: async () => cache };
    const networkResponse = {
      status: 200,
      type: "basic",
      headers: new Headers({ "content-type": "text/css" }),
      clone() {
        return this;
      },
    };
    scope.fetch = async () => networkResponse;
    const warnings: string[] = [];
    scope.console = { warn: (message: string) => warnings.push(message) };

    const waits: Array<Promise<unknown>> = [];
    let response: Promise<unknown> | undefined;
    const event = {
      request: {
        url: "http://localhost:3000/_next/static/app.css",
        method: "GET",
        mode: "no-cors",
        destination: "style",
        headers: new Headers({ accept: "text/css" }),
      },
      respondWith: (value: Promise<unknown>) => {
        response = value;
      },
      waitUntil: (value: Promise<unknown>) => {
        waits.push(value);
      },
    };
    (listeners.fetch as (e: unknown) => void)(event);

    // The good network response still comes back even though the write is rejected.
    await expect(response).resolves.toBe(networkResponse);
    expect(waits).toHaveLength(1);
    await waits[0];
    expect(putCalls).toHaveLength(1);
    expect(warnings.join(" ")).toMatch(/could not save/);
    resolvePut?.();
  });
});

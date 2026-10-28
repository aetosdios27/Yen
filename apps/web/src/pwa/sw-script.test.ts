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
});

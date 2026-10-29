import { createApp } from "./app.js";
import type { AppDependencies } from "./dependencies.js";
import { devPolicy } from "./policy.js";

export function createMockApp(overrides: Partial<AppDependencies> = {}) {
  return createApp({
    ...overrides,
    policy: overrides.policy ?? devPolicy,
    principal: { id: "00000000-0000-4000-8000-000000000001", role: "owner" },
    corsOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  });
}
